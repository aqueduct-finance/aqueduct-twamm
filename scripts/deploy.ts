import { ethers } from "hardhat";
import { deployTestFramework } from "@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework";
import TestToken from "@superfluid-finance/ethereum-contracts/build/contracts/TestToken.json";
import { Framework } from "@superfluid-finance/sdk-core";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

async function main() {
  let owner: SignerWithAddress;

  [owner] = await ethers.getSigners();
  const sfDeployer = await deployTestFramework();
  const contractsFramework = await sfDeployer.frameworkDeployer.getFramework();
  const sf = await Framework.create({
    chainId: 31337,
    provider: ethers.provider,
    resolverAddress: contractsFramework.resolver, // (empty)
    protocolReleaseVersion: "test",
  });

  // DEPLOYING DAI and DAI wrapper super token (which will be our `spreaderToken`)
  await sfDeployer.superTokenDeployer.deployWrapperSuperToken(
    "Base Token A",
    "baseTokenA",
    18,
    ethers.utils.parseEther("10000").toString()
  );
  await sfDeployer.superTokenDeployer.deployWrapperSuperToken(
    "Base Token B",
    "baseTokenB",
    18,
    ethers.utils.parseEther("10000").toString()
  );

  const tokenA = await sf.loadSuperToken("baseTokenAx");
  const baseTokenA = new ethers.Contract(
    tokenA.underlyingToken!.address,
    TestToken.abi,
    owner
  );

  const tokenB = await sf.loadSuperToken("baseTokenBx");
  const baseTokenB = new ethers.Contract(
    tokenB.underlyingToken!.address,
    TestToken.abi,
    owner
  );

  const setupToken = async (underlyingToken: any, superToken: any) => {
    // minting test token
    await underlyingToken.mint(
      owner.address,
      ethers.utils.parseEther("10000").toString()
    );

    // approving DAIx to spend DAI (Super Token object is not an ethers contract object and has different operation syntax)
    await underlyingToken.approve(
      superToken.address,
      ethers.constants.MaxInt256
    );
    await underlyingToken
      .connect(owner)
      .approve(superToken.address, ethers.constants.MaxInt256);
    // Upgrading all DAI to DAIx
    const ownerUpgrade = superToken.upgrade({
      amount: ethers.utils.parseEther("10000").toString(),
    });
    await ownerUpgrade.exec(owner);
  };

  await setupToken(baseTokenA, tokenA);
  await setupToken(baseTokenB, tokenB);

  const uniswapV2Factory = await (
    await ethers.getContractFactory("UniswapV2Factory")
  ).deploy(owner.address, contractsFramework.host);

  await uniswapV2Factory.createPair(tokenA.address, tokenB.address);
  const uniswapV2Pair = (
    await ethers.getContractFactory("UniswapV2Pair")
  ).attach(await uniswapV2Factory.getPair(tokenA.address, tokenB.address));

  console.log(`UniswapV2Factory deployed to ${uniswapV2Factory.address}`);
  console.log(`UniswapV2Pair deployed to ${uniswapV2Pair.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
