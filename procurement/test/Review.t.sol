// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import './Procurement.t.sol';
contract ProcurementReviewTest is ProcurementTest {
 function testBuyerCanAlsoBeReviewerAndResolver() public {
  vm.warp(100);
  Procurement q=new Procurement(t,address(this),address(this),bytes32(uint256(1)),100,200,300,20);
  require(q.buyer()==q.reviewer() && q.buyer()==q.resolver());
 }
 function testResolverInactivityHasNoExpiry() public {
  submitted();p.dispute(0);vm.warp(1000000);
  vm.expectRevert();p.expire();
  vm.expectRevert();vm.prank(alice);p.claim();
  require(t.balanceOf(address(p))==100 && p.remaining()==100);
 }
 function testBuyerCanDisputeWithoutReasonBeforeReviewDeadline() public {
  submitted();p.dispute(0);
  (,,,,Procurement.Progress progress)=p.milestones(0);
  require(progress==Procurement.Progress.Disputed);
  vm.expectRevert();vm.prank(judge);p.approve(0,bytes32(uint256(5)));
 }
}
