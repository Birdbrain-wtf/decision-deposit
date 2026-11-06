// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "./DecisionDepositPool.sol";

/// Anyone opens a decision-deposit pool for any referendum, on any track.
///
/// The factory fixes what depends on the chain (Referenda pallet and call
/// indices, the planck-to-wei ratio), so the person opening a pool chooses only
/// the referendum, the deposit, the smallest payment, the funding close and
/// where stray KSM goes. It cannot check those against governance (a contract
/// cannot read chain storage), but a wrong deposit only means the pool can never
/// place, and the balance check refuses it; contributors are repaid after the
/// close. The page checks a pool against the live referendum before showing it.
///
/// No owner. The factory holds no money and has no power over any pool.
contract DecisionDepositPoolFactory {
    uint8 public immutable referendaPallet;
    uint8 public immutable placeCallIndex;
    uint8 public immutable refundCallIndex;
    uint256 public immutable weiPerPlanck;

    address[] public pools;
    mapping(uint32 => address[]) private byReferendum;

    event PoolOpened(
        uint32 indexed referendum,
        address indexed pool,
        address indexed by,
        uint256 depositPlanck,
        uint256 minContributionPlanck,
        uint64 fundingDeadline,
        address sweepTo
    );

    constructor(uint8 referendaPallet_, uint8 placeCallIndex_, uint8 refundCallIndex_, uint256 weiPerPlanck_) {
        require(weiPerPlanck_ > 0);
        referendaPallet = referendaPallet_;
        placeCallIndex = placeCallIndex_;
        refundCallIndex = refundCallIndex_;
        weiPerPlanck = weiPerPlanck_;
    }

    function open(
        uint32 referendum,
        uint256 depositPlanck,
        uint256 minContributionPlanck,
        uint64 fundingDeadline,
        address sweepTo
    ) external returns (address pool) {
        pool = address(
            new DecisionDepositPool(
                referendum,
                depositPlanck,
                minContributionPlanck,
                fundingDeadline,
                referendaPallet,
                placeCallIndex,
                refundCallIndex,
                weiPerPlanck,
                sweepTo
            )
        );
        pools.push(pool);
        byReferendum[referendum].push(pool);
        emit PoolOpened(referendum, pool, msg.sender, depositPlanck, minContributionPlanck, fundingDeadline, sweepTo);
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function poolsFor(uint32 referendum) external view returns (address[] memory) {
        return byReferendum[referendum];
    }
}
