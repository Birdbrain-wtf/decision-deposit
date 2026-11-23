// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import '../src/Procurement.sol';
import '../src/DemoPlaceholderAsset.sol';
interface Vm2 { function warp(uint256) external; function prank(address) external; function expectRevert() external; }
contract DemoTest {
 Vm2 constant vm=Vm2(address(uint160(uint256(keccak256('hevm cheat code')))));
 function testDemoTenderCanNeverBeFunded() public {
  vm.warp(100);
  DemoPlaceholderAsset d=new DemoPlaceholderAsset();
  Procurement p=new Procurement(d,address(this),address(this),bytes32(uint256(1)),100,200,300,20);
  address alice=address(0xA11CE);
  vm.prank(alice);p.bid(100,bytes32(uint256(2)));
  vm.warp(200);
  uint256[] memory a=new uint256[](1);a[0]=100;uint64[] memory t=new uint64[](1);t[0]=400;
  p.award(alice,a,t,bytes32(uint256(3)));
  vm.expectRevert();vm.prank(alice);p.acceptAndFund(bytes32(uint256(2)));
  require(p.state()==Procurement.State.Awarded && d.balanceOf(address(p))==0);
  vm.warp(300);p.expire();
  require(p.state()==Procurement.State.Closed);
 }
}
