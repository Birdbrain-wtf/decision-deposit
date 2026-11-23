// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import "./Procurement.sol";
// A stand-in for dUSD in the unfunded demonstration. It has no supply, every balance is zero
// and every transfer fails, so a tender pointed at it can take bids but can never be funded.
contract DemoPlaceholderAsset is Asset {
    string public constant name = "NOT dUSD - unfunded procurement demo placeholder";
    string public constant symbol = "DEMO-NOT-DUSD";
    uint8 public constant decimals = 6;
    uint256 public constant totalSupply = 0;
    function balanceOf(address) external pure returns (uint256) { return 0; }
    function transfer(address, uint256) external pure returns (bool) { revert("demo placeholder: no transfers"); }
    function transferFrom(address, address, uint256) external pure returns (bool) { revert("demo placeholder: no transfers"); }
}
