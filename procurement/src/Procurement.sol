// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
interface Asset {
    function balanceOf(address) external view returns(uint256);
    function transfer(address,uint256) external returns(bool);
    function transferFrom(address,address,uint256) external returns(bool);
}
contract Procurement {
    enum State { Bidding, Awarded, Active, Closed }
    enum Progress { Pending, Submitted, Disputed, Settled }
    struct Bid { uint256 price; bytes32 terms; }
    struct Milestone { uint256 amount; uint64 due; uint64 submitted; bytes32 evidence; Progress progress; }
    Asset public immutable asset;
    address public immutable buyer;
    address public immutable reviewer;
    address public immutable resolver;
    bytes32 public immutable specification;
    uint256 public immutable ceiling;
    uint64 public immutable bidClose;
    uint64 public immutable activationClose;
    uint64 public immutable reviewPeriod;
    State public state;
    address public contractor;
    uint256 public remaining;
    uint256 public unsettled;
    mapping(address => Bid) public bids;
    mapping(address => uint256) public credit;
    Milestone[] public milestones;
    bool private entered;
    event BidPlaced(address indexed bidder,uint256 price,bytes32 terms);
    event Awarded(address indexed contractor,bytes32 reason);
    event Activated();
    event Submitted(uint256 indexed milestone,bytes32 evidence);
    event Disputed(uint256 indexed milestone);
    event Settled(uint256 indexed milestone,uint256 contractorAmount,bytes32 reason);
    event Claimed(address indexed recipient,uint256 amount);
    event Closed();
    modifier lock() { require(!entered); entered=true; _; entered=false; }
    constructor(Asset token,address judge,address arbiter,bytes32 spec,uint256 cap,uint64 close,uint64 startBy,uint64 review) {
        require(address(token).code.length>0 && judge!=address(0) && arbiter!=address(0));
        require(spec!=0 && cap>0 && close>block.timestamp && startBy>close && review>0);
        asset=token; buyer=msg.sender; reviewer=judge; resolver=arbiter; specification=spec;
        ceiling=cap; bidClose=close; activationClose=startBy; reviewPeriod=review;
    }
    function bid(uint256 price,bytes32 terms) external {
        require(state==State.Bidding && block.timestamp<bidClose && price>0 && price<=ceiling && terms!=0);
        bids[msg.sender]=Bid(price,terms); emit BidPlaced(msg.sender,price,terms);
    }
    function award(address supplier,uint256[] calldata amounts,uint64[] calldata dates,bytes32 reason) external {
        require(msg.sender==buyer && state==State.Bidding && block.timestamp>=bidClose && block.timestamp<activationClose);
        require(supplier!=buyer && supplier!=reviewer && supplier!=resolver && bids[supplier].price>0 && reason!=0);
        require(amounts.length>0 && amounts.length<=32 && amounts.length==dates.length);
        uint256 sum;
        for(uint256 i; i<amounts.length;i++) {
            require(amounts[i]>0 && dates[i]>activationClose);
            sum+=amounts[i]; milestones.push(Milestone(amounts[i],dates[i],0,0,Progress.Pending));
        }
        require(sum==bids[supplier].price);
        contractor=supplier; remaining=sum; unsettled=amounts.length; state=State.Awarded;
        emit Awarded(supplier,reason);
    }
    function acceptAndFund(bytes32 expectedTerms) external lock {
        require(msg.sender==contractor && state==State.Awarded && block.timestamp<activationClose);
        require(expectedTerms==bids[contractor].terms);
        uint256 beforeBalance=asset.balanceOf(address(this));
        state=State.Active;
        require(asset.transferFrom(buyer,address(this),remaining));
        require(asset.balanceOf(address(this))==beforeBalance+remaining);
        emit Activated();
    }
    function expire() external {
        require((state==State.Bidding || state==State.Awarded) && block.timestamp>=activationClose);
        state=State.Closed; remaining=0; emit Closed();
    }
    function submit(uint256 id,bytes32 evidence) external {
        Milestone storage m=milestones[id];
        require(state==State.Active && msg.sender==contractor && m.progress==Progress.Pending && block.timestamp<=m.due && evidence!=0);
        m.progress=Progress.Submitted; m.evidence=evidence; m.submitted=uint64(block.timestamp); emit Submitted(id,evidence);
    }
    function approve(uint256 id,bytes32 reason) external {
        require(msg.sender==reviewer && milestones[id].progress==Progress.Submitted);
        settle(id,milestones[id].amount,reason);
    }
    function dispute(uint256 id) external {
        Milestone storage m=milestones[id];
        require(state==State.Active && (msg.sender==buyer || msg.sender==contractor || msg.sender==reviewer));
        require(m.progress==Progress.Submitted || (m.progress==Progress.Pending && block.timestamp>m.due));
        if(msg.sender==contractor && m.progress==Progress.Submitted) require(block.timestamp>=uint256(m.submitted)+reviewPeriod);
        m.progress=Progress.Disputed; emit Disputed(id);
    }
    function resolve(uint256 id,uint256 pay,bytes32 reason) external {
        require(msg.sender==resolver && milestones[id].progress==Progress.Disputed); settle(id,pay,reason);
    }
    function settle(uint256 id,uint256 pay,bytes32 reason) private {
        Milestone storage m=milestones[id];
        require(state==State.Active && pay<=m.amount && reason!=0);
        m.progress=Progress.Settled; remaining-=m.amount; credit[contractor]+=pay; credit[buyer]+=m.amount-pay;
        emit Settled(id,pay,reason);
        if(--unsettled==0) { state=State.Closed; emit Closed(); }
    }
    function claim() external lock {
        uint256 amount=credit[msg.sender]; require(amount>0); credit[msg.sender]=0;
        require(asset.transfer(msg.sender,amount)); emit Claimed(msg.sender,amount);
    }
}
