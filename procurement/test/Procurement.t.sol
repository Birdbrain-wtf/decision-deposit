// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import '../src/Procurement.sol';
interface Vm { function warp(uint256) external; function prank(address) external; function expectRevert() external; }
contract Token is Asset {
 mapping(address=>uint256) public balanceOf;
 bool public fail;
 function setFail(bool value) external {fail=value;}
 function mint(address a,uint256 n) external {balanceOf[a]+=n;}
 function transfer(address a,uint256 n) external returns(bool) {if(fail)return false; balanceOf[msg.sender]-=n;balanceOf[a]+=n;return true;}
 function transferFrom(address a,address b,uint256 n) external returns(bool) {balanceOf[a]-=n;balanceOf[b]+=n;return true;}
}
contract ProcurementTest {
 Vm constant vm=Vm(address(uint160(uint256(keccak256('hevm cheat code')))));
 Token t; Procurement p;
 address alice=address(0xA11CE); address judge=address(2); address arbiter=address(3);
 function setUp() public {
 vm.warp(100);t=new Token(); p=new Procurement(t,judge,arbiter,bytes32(uint256(1)),100,200,300,20);
 t.mint(address(this),100);vm.prank(alice);p.bid(100,bytes32(uint256(2)));vm.warp(200);
 uint256[] memory a=new uint256[](1);a[0]=100;uint64[] memory d=new uint64[](1);d[0]=400;
 p.award(alice,a,d,bytes32(uint256(3)));vm.prank(alice);p.acceptAndFund(bytes32(uint256(2)));
 }
 function submitted() internal {vm.prank(alice);p.submit(0,bytes32(uint256(4)));}
 function testPaymentAndDoubleClaim() public {submitted();vm.prank(judge);p.approve(0,bytes32(uint256(5)));vm.prank(alice);p.claim();require(t.balanceOf(alice)==100 && p.remaining()==0);vm.expectRevert();vm.prank(alice);p.claim();}
 function testUnauthorisedApproval() public {submitted();vm.expectRevert();p.approve(0,bytes32(uint256(5)));}
 function testTransferFailurePreservesClaim() public {submitted();vm.prank(judge);p.approve(0,bytes32(uint256(5)));t.setFail(true);vm.expectRevert();vm.prank(alice);p.claim();require(p.credit(alice)==100);}
 function testFuzzDisputeConservation(uint8 allocation) public {uint256 pay=uint256(allocation)%101;submitted();p.dispute(0);vm.prank(arbiter);p.resolve(0,pay,bytes32(uint256(5)));require(p.credit(alice)+p.credit(address(this))==100 && p.remaining()==0);}
 function testLateSubmission() public {vm.warp(401);vm.expectRevert();submitted();p.dispute(0);vm.prank(arbiter);p.resolve(0,0,bytes32(uint256(5)));p.claim();require(t.balanceOf(address(this))==100);}
 function testReviewTimeout() public {submitted();vm.expectRevert();vm.prank(alice);p.dispute(0);vm.warp(220);vm.prank(alice);p.dispute(0);}
 function testDuplicateApproval() public {submitted();vm.prank(judge);p.approve(0,bytes32(uint256(5)));vm.expectRevert();vm.prank(judge);p.approve(0,bytes32(uint256(5)));}
}
