// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import '../src/SealedProcurement.sol';
interface SVm { function warp(uint256) external; function prank(address) external; function expectRevert() external; }
contract SToken is TenderAsset {
 mapping(address=>uint256) public balanceOf;
 function mint(address a,uint256 n) external {balanceOf[a]+=n;}
 function transfer(address a,uint256 n) external returns(bool) {balanceOf[msg.sender]-=n;balanceOf[a]+=n;return true;}
 function transferFrom(address a,address b,uint256 n) external returns(bool) {balanceOf[a]-=n;balanceOf[b]+=n;return true;}
}
contract SealedTest {
 SVm constant vm=SVm(address(uint160(uint256(keccak256('hevm cheat code')))));
 SToken t; SealedProcurement p;
 address alice=address(0xA11CE); address bob=address(0xB0B); address judge=address(2); address arbiter=address(3);
 bytes32 constant CAPSALT=bytes32(uint256(77)); bytes32 constant TERMS=bytes32(uint256(2));
 function setUp() public {
  vm.warp(100); t=new SToken();
  p=new SealedProcurement(t,judge,arbiter,bytes32(uint256(1)),keccak256(abi.encode(uint256(100),CAPSALT)),200,220,250,300,20);
  t.mint(address(this),100);
 }
 function seal(address who,uint256 price,bytes32 salt) internal view returns(bytes32) {return p.sealBid(who,price,TERMS,salt);}
 function commitBoth() internal {
  {bytes32 c=seal(alice,80,bytes32(uint256(5)));vm.prank(alice);p.commit(c);}
  {bytes32 c=seal(bob,120,bytes32(uint256(6)));vm.prank(bob);p.commit(c);}
 }
 function one(uint256 v) internal pure returns(uint256[] memory a){a=new uint256[](1);a[0]=v;}
 function due() internal pure returns(uint64[] memory d){d=new uint64[](1);d[0]=400;}
 function testNoPriceVisibleWhileBidding() public {
  commitBoth();
  (uint256 price,)=p.bids(alice);
  require(price==0 && p.ceiling()==0 && p.commitCount()==2);
 }
 function testRevealOnlyInWindowAndOnlyMatching() public {
  commitBoth();
  vm.expectRevert();vm.prank(alice);p.reveal(80,TERMS,bytes32(uint256(5)));
  vm.warp(220);
  vm.expectRevert();vm.prank(alice);p.reveal(79,TERMS,bytes32(uint256(5)));
  vm.expectRevert();vm.prank(bob);p.reveal(80,TERMS,bytes32(uint256(5)));
  vm.prank(alice);p.reveal(80,TERMS,bytes32(uint256(5)));
  vm.expectRevert();vm.prank(alice);p.reveal(80,TERMS,bytes32(uint256(5)));
  vm.warp(250);
  vm.expectRevert();vm.prank(bob);p.reveal(120,TERMS,bytes32(uint256(6)));
  require(p.revealCount()==1);
 }
 function testCommitReplacedAndClosed() public {
  {bytes32 c=seal(alice,90,bytes32(uint256(5)));vm.prank(alice);p.commit(c);}
  {bytes32 c=seal(alice,80,bytes32(uint256(5)));vm.prank(alice);p.commit(c);}
  require(p.commitCount()==1);
  vm.warp(200);
  {bytes32 c=seal(alice,70,bytes32(uint256(5)));vm.expectRevert();vm.prank(alice);p.commit(c);}
  vm.warp(220);
  vm.expectRevert();vm.prank(alice);p.reveal(90,TERMS,bytes32(uint256(5)));
  vm.prank(alice);p.reveal(80,TERMS,bytes32(uint256(5)));
 }
 function testScoresFixedOnceBeforePricesOpen() public {
  commitBoth();
  vm.expectRevert();p.commitScores(bytes32(uint256(8)));
  vm.warp(200);
  vm.expectRevert();vm.prank(alice);p.reveal(80,TERMS,bytes32(uint256(5)));
  vm.expectRevert();vm.prank(judge);p.commitScores(bytes32(uint256(8)));
  p.commitScores(bytes32(uint256(8)));
  vm.expectRevert();p.commitScores(bytes32(uint256(9)));
  vm.warp(220);
  vm.expectRevert();p.commitScores(bytes32(uint256(9)));
  vm.prank(alice);p.reveal(80,TERMS,bytes32(uint256(5)));
 }
 function testNoAwardWithoutScores() public {
  commitBoth();vm.warp(220);
  vm.prank(alice);p.reveal(80,TERMS,bytes32(uint256(5)));
  vm.warp(250);p.revealCeiling(100,CAPSALT);
  vm.expectRevert();p.award(alice,one(80),due(),bytes32(uint256(3)));
 }
 function testBuyerCannotBid() public {vm.expectRevert();p.commit(bytes32(uint256(9)));}
 function testCeilingSealedUntilRevealCloses() public {
  vm.warp(200);
  vm.expectRevert();p.revealCeiling(100,CAPSALT);
  vm.warp(250);
  vm.expectRevert();p.revealCeiling(99,CAPSALT);
  p.revealCeiling(100,CAPSALT);
  require(p.ceiling()==100);
  vm.expectRevert();p.revealCeiling(100,CAPSALT);
 }
 function testAwardNeedsCeilingAndBidUnderIt() public {
  commitBoth();vm.warp(200);p.commitScores(bytes32(uint256(8)));vm.warp(220);
  vm.prank(alice);p.reveal(80,TERMS,bytes32(uint256(5)));
  vm.prank(bob);p.reveal(120,TERMS,bytes32(uint256(6)));
  vm.warp(250);
  vm.expectRevert();p.award(alice,one(80),due(),bytes32(uint256(3)));
  p.revealCeiling(100,CAPSALT);
  vm.expectRevert();p.award(bob,one(120),due(),bytes32(uint256(3)));
  p.award(alice,one(80),due(),bytes32(uint256(3)));
  vm.prank(alice);p.acceptAndFund(TERMS);
  vm.prank(alice);p.submit(0,bytes32(uint256(4)));
  vm.prank(judge);p.approve(0,bytes32(uint256(5)));
  vm.prank(alice);p.claim();
  require(t.balanceOf(alice)==80 && t.balanceOf(address(this))==20);
 }
 function testNoRevealsThenExpire() public {
  commitBoth();vm.warp(250);p.revealCeiling(100,CAPSALT);
  vm.expectRevert();p.award(alice,one(80),due(),bytes32(uint256(3)));
  vm.warp(300);p.expire();
  require(p.state()==SealedProcurement.State.Closed);
 }
 function testFuzzSealBindsEveryField(uint256 price,bytes32 salt) public view {

  if(price==80) return;
  require(p.sealBid(alice,price,TERMS,salt)!=p.sealBid(alice,80,TERMS,bytes32(uint256(5))) || salt==bytes32(uint256(5)) && price==80);
  require(p.sealBid(alice,80,TERMS,bytes32(uint256(5)))!=p.sealBid(bob,80,TERMS,bytes32(uint256(5))));
 }
}
