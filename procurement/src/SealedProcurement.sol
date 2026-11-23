// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
// One tender with sealed bids and a sealed budget.
// Bidding: each bidder commits keccak256(abi.encode(tender, bidder, price, terms, salt)). Nobody sees a price.
// Scoring window: the offer documents (no prices in them) are published, and the buyer fixes a hash of its
// quality scores on chain, once. Only then do prices open.
// Reveal window: bidders open their own commitments. An unopened commitment is not a bid.
// After the reveal window: anyone who knows the buyer's salt opens the ceiling, committed at deployment as
// keccak256(abi.encode(ceiling, salt)). The award needs the ceiling opened and a bid at or under it.
// From the award on, this is the same milestone escrow as Procurement.sol.
interface TenderAsset {
    function balanceOf(address) external view returns(uint256);
    function transfer(address,uint256) external returns(bool);
    function transferFrom(address,address,uint256) external returns(bool);
}
contract SealedProcurement {
    enum State { Bidding, Awarded, Active, Closed }
    enum Progress { Pending, Submitted, Disputed, Settled }
    struct Bid { uint256 price; bytes32 terms; }
    struct Milestone { uint256 amount; uint64 due; uint64 submitted; bytes32 evidence; Progress progress; }
    TenderAsset public immutable asset;
    address public immutable buyer;
    address public immutable reviewer;
    address public immutable resolver;
    bytes32 public immutable specification;
    bytes32 public immutable ceilingCommitment;
    uint64 public immutable bidClose;
    uint64 public immutable scoreClose;
    uint64 public immutable revealClose;
    uint64 public immutable activationClose;
    uint64 public immutable reviewPeriod;
    State public state;
    uint256 public ceiling;
    bytes32 public qualityScores;
    address public contractor;
    uint256 public remaining;
    uint256 public unsettled;
    uint256 public commitCount;
    uint256 public revealCount;
    mapping(address => bytes32) public commitments;
    mapping(address => Bid) public bids;
    mapping(address => uint256) public credit;
    Milestone[] public milestones;
    bool private entered;
    event BidCommitted(address indexed bidder,bytes32 commitment);
    event ScoresCommitted(bytes32 scores);
    event BidRevealed(address indexed bidder,uint256 price,bytes32 terms);
    event CeilingRevealed(uint256 ceiling);
    event Awarded(address indexed contractor,bytes32 reason);
    event Activated();
    event Submitted(uint256 indexed milestone,bytes32 evidence);
    event Disputed(uint256 indexed milestone);
    event Settled(uint256 indexed milestone,uint256 contractorAmount,bytes32 reason);
    event Claimed(address indexed recipient,uint256 amount);
    event Closed();
    modifier lock() { require(!entered); entered=true; _; entered=false; }
    constructor(TenderAsset token,address judge,address arbiter,bytes32 spec,bytes32 capCommitment,uint64 close,uint64 scoreBy,uint64 revealBy,uint64 startBy,uint64 review) {
        require(address(token).code.length>0 && judge!=address(0) && arbiter!=address(0));
        require(spec!=0 && capCommitment!=0 && close>block.timestamp && scoreBy>close && revealBy>scoreBy && startBy>revealBy && review>0);
        asset=token; buyer=msg.sender; reviewer=judge; resolver=arbiter; specification=spec; ceilingCommitment=capCommitment;
        bidClose=close; scoreClose=scoreBy; revealClose=revealBy; activationClose=startBy; reviewPeriod=review;
    }
    function sealBid(address bidder,uint256 price,bytes32 terms,bytes32 salt) public view returns(bytes32) {
        return keccak256(abi.encode(address(this),bidder,price,terms,salt));
    }
    function commit(bytes32 commitment) external {
        require(state==State.Bidding && block.timestamp<bidClose && commitment!=0);
        require(msg.sender!=buyer && msg.sender!=reviewer && msg.sender!=resolver);
        if(commitments[msg.sender]==0) commitCount++;
        commitments[msg.sender]=commitment; emit BidCommitted(msg.sender,commitment);
    }
    function commitScores(bytes32 scores) external {
        require(msg.sender==buyer && block.timestamp>=bidClose && block.timestamp<scoreClose && qualityScores==0 && scores!=0);
        qualityScores=scores; emit ScoresCommitted(scores);
    }
    function reveal(uint256 price,bytes32 terms,bytes32 salt) external {
        require(state==State.Bidding && block.timestamp>=scoreClose && block.timestamp<revealClose);
        require(price>0 && terms!=0 && bids[msg.sender].price==0);
        require(commitments[msg.sender]!=0 && sealBid(msg.sender,price,terms,salt)==commitments[msg.sender]);
        bids[msg.sender]=Bid(price,terms); revealCount++; emit BidRevealed(msg.sender,price,terms);
    }
    function revealCeiling(uint256 cap,bytes32 salt) external {
        require(block.timestamp>=revealClose && ceiling==0 && cap>0 && keccak256(abi.encode(cap,salt))==ceilingCommitment);
        ceiling=cap; emit CeilingRevealed(cap);
    }
    function award(address supplier,uint256[] calldata amounts,uint64[] calldata dates,bytes32 reason) external {
        require(msg.sender==buyer && state==State.Bidding && block.timestamp>=revealClose && block.timestamp<activationClose);
        require(ceiling>0 && qualityScores!=0 && bids[supplier].price>0 && bids[supplier].price<=ceiling && reason!=0);
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
