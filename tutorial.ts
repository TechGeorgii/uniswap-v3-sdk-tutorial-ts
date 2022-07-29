// Command-line utilities
import yargs from "yargs/yargs"
import { hideBin } from 'yargs/helpers'
import 'dotenv/config'

// Uniswap and Web3 modules
import { ethers } from "ethers";
import QuoterABI from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json'
import { Pool } from '@uniswap/v3-sdk/'
import { TradeType, Token, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { AlphaRouter } from '@uniswap/smart-order-router'
import IUniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import IUniswapV3Factory from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json'
import { BigNumber } from '@ethersproject/bignumber';

import ERC20_abi from "./ERC20_abi.json"

async function main() {
    const options = await yargs(hideBin(process.argv))
        .usage("Swaps tokens, based on Uniswap V3 SDK")
        .option("chain-id", { describe: "Chain id to work on", type: "string", demandOption: true })
        .option("wallet-address", { describe: "Your wallet address", type: "string", demandOption: true })
        .option("token-in-address", { describe: "Input token (that you'd spend) smart contract address", type: "string", demandOption: true })
        .option("token-out-address", { describe: "Output token (that you'd receive) smart contract address", type: "string", demandOption: true })
        .option("amount-in", { describe: "Input token amount to swap", type: "string", demandOption: true })
        .argv;


    const chainId = parseInt(options.chainId);  // chainId must be integer
    const walletAddress = options.walletAddress;
    const tokenInContractAddress = options.tokenInAddress;
    const tokenOutContractAddress = options.tokenOutAddress;
    const inAmountStr = options.amountIn;
    const { API_URL, PRIVATE_KEY } = process.env;

    // ============= PART 1 --- connect to blockchain and get token balances
    console.log("Connecting to blockchain, loading token balances...");
    console.log('');

    // Ethers.js provider to access blockchain
    // As we're using Alchemy, it is JsonRpcProvider
    // In case of React app + MetaMask it should be initialized as "new ethers.providers.Web3Provider(window.ethereum);"
    const provider = new ethers.providers.JsonRpcProvider(API_URL, chainId);


    const signer = new ethers.Wallet(PRIVATE_KEY!, provider);

    // // In case of React + Metamask it should be initialized as "provider.getSigner();"
    // // as we already have signer provided by Metamask
    // var signer = wallet.provider.getSigner(wallet.address);


    // create token contracts and related objects
    const contractIn = new ethers.Contract(tokenInContractAddress, ERC20_abi, signer);
    const contractOut = new ethers.Contract(tokenOutContractAddress, ERC20_abi, signer);

    const getTokenAndBalance = async function (contract: ethers.Contract) {
        var [dec, symbol, name, balance] = await Promise.all(
            [
                contract.decimals(),
                contract.symbol(),
                contract.name(),
                contract.balanceOf(walletAddress)
            ]);

        return [new Token(chainId, contract.address, dec, symbol, name), balance];
    }

    const [tokenIn, balanceTokenIn] = await getTokenAndBalance(contractIn);
    const [tokenOut, balanceTokenOut] = await getTokenAndBalance(contractOut);

    console.log(`Wallet ${walletAddress} balances:`);
    console.log(`   Input: ${tokenIn.symbol} (${tokenIn.name}): ${ethers.utils.formatUnits(balanceTokenIn, tokenIn.decimals)}`);
    console.log(`   Output: ${tokenOut.symbol} (${tokenOut.name}): ${ethers.utils.formatUnits(balanceTokenOut, tokenOut.decimals)}`);
    console.log("");

    // ============= PART 2 --- get Uniswap pool for pair TokenIn-TokenOut
    console.log("Loading pool information...");

    // this is Uniswap factory, same address on all chains
    // (from https://docs.uniswap.org/protocol/reference/deployments)
    const UNISWAP_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
    const factoryContract = new ethers.Contract(UNISWAP_FACTORY_ADDRESS, IUniswapV3Factory.abi, provider);

    // loading pool smart contract address
    const poolAddress = await factoryContract.getPool(
        tokenIn.address,
        tokenOut.address,
        3000);  // commission - 3%

    if (Number(poolAddress).toString() === "0") // there is no such pool for provided In-Out tokens.
        throw `Error: No pool ${tokenIn.symbol}-${tokenOut.symbol}`;

    const poolContract = new ethers.Contract(poolAddress, IUniswapV3Pool.abi, provider);

    const getPoolState = async function () {
        const [liquidity, slot] = await Promise.all([poolContract.liquidity(), poolContract.slot0()]);

        return {
            liquidity: liquidity,
            sqrtPriceX96: slot[0],
            tick: slot[1],
            observationIndex: slot[2],
            observationCardinality: slot[3],
            observationCardinalityNext: slot[4],
            feeProtocol: slot[5],
            unlocked: slot[6],
        }
    }

    const getPoolImmutables = async function () {
        const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
            poolContract.factory(),
            poolContract.token0(),
            poolContract.token1(),
            poolContract.fee(),
            poolContract.tickSpacing(),
            poolContract.maxLiquidityPerTick(),
        ]);

        return {
            factory: factory,
            token0: token0,
            token1: token1,
            fee: fee,
            tickSpacing: tickSpacing,
            maxLiquidityPerTick: maxLiquidityPerTick,
        }
    }

    // loading immutable pool parameters and its current state (variable parameters)
    const [immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()]);

    const pool = new Pool(
        tokenIn,
        tokenOut,
        immutables.fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick
    );

    // print token prices in the pool
    console.log("Token prices in pool:");
    console.log(`   1 ${pool.token0.symbol} = ${pool.token0Price.toSignificant()} ${pool.token1.symbol}`);
    console.log(`   1 ${pool.token1.symbol} = ${pool.token1Price.toSignificant()} ${pool.token0.symbol}`);
    console.log('');


    // ============= PART 3 --- Giving a quote for user input
    console.log("Loading up quote for a swap...");

    const amountIn = ethers.utils.parseUnits(inAmountStr, tokenIn.decimals);

    // this is Uniswap quoter smart contract, same address on all chains
    // (from https://docs.uniswap.org/protocol/reference/deployments)
    const UNISWAP_QUOTER_ADDRESS = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
    const quoterContract = new ethers.Contract(UNISWAP_QUOTER_ADDRESS, QuoterABI.abi, provider);

    const quotedAmountOut = await quoterContract.callStatic.quoteExactInputSingle(
        tokenIn.address,
        tokenOut.address,
        pool.fee,
        amountIn,
        0
    );

    console.log(`   You'll get approximately ${ethers.utils.formatUnits(quotedAmountOut, tokenOut.decimals)} ${tokenOut.symbol} for ${inAmountStr} ${tokenIn.symbol}`);
    console.log('');


    // ============= PART 4 --- Loading a swap route
    console.log('');
    console.log("Loading a swap route...");

    const inAmount = CurrencyAmount.fromRawAmount(tokenIn, amountIn.toString());

    const router = new AlphaRouter({ chainId: tokenIn.chainId, provider: provider });
    const route = await router.route(
        inAmount,
        tokenOut,
        TradeType.EXACT_INPUT,
        // swapOptions
        {
            recipient: walletAddress,
            slippageTolerance: new Percent(5, 100),          // Big slippage – for a test
            deadline: Math.floor(Date.now() / 1000 + 1800)    // add 1800 seconds – 30 mins deadline
        },
        // router config
        {
            // only one direct swap for a reason – 2 swaps thru DAI (USDT->DAI->WETH) didn't work on Rinkeby
            // There was an overflow problem https://rinkeby.etherscan.io/tx/0xaed297f2f51f17b329ce755b11635980268f3fc88aae10e78cf59f2c6e65ca7f
            // The was DAI balance for UniswapV2Pair was greater than 2^112-1 (https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol)
            // UniswapV2Pair – https://rinkeby.etherscan.io/address/0x8b22f85d0c844cf793690f6d9dfe9f11ddb35449
            // WETH – https://rinkeby.etherscan.io/address/0xc778417e063141139fce010982780140aa0cd5ab#readContract
            // DAI – https://rinkeby.etherscan.io/address/0xc7ad46e0b8a400bb3c915120d284aafba8fc4735#readContract (balance of UniswapV2Pair more than 2^112-1)

            maxSwapsPerPath: 1 // remove this if you want multi-hop swaps as well.
        }
    );

    if (route == null || route.methodParameters === undefined)
        throw "No route loaded";

    console.log(`   You'll get ${route.quote.toFixed()} of ${tokenOut.symbol}`);

    // output quote minus gas fees
    console.log(`   Gas Adjusted Quote: ${route.quoteGasAdjusted.toFixed()}`);
    console.log(`   Gas Used Quote Token: ${route.estimatedGasUsedQuoteToken.toFixed()}`);
    console.log(`   Gas Used USD: ${route.estimatedGasUsedUSD.toFixed()}`);
    console.log(`   Gas Used: ${route.estimatedGasUsed.toString()}`);
    console.log(`   Gas Price Wei: ${route.gasPriceWei}`);
    console.log('');

    // // ============= PART 5 --- Making actual swap
    console.log("Approving amount to spend...");

    // address of a swap router
    const V3_SWAP_ROUTER_ADDRESS = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';

    // For Metamask it will be just "await contractIn.approve(V3_SWAP_ROUTER_ADDRESS, amountIn);"

    // here we just create a transaction object (not sending it to blockchain).
    const approveTxUnsigned = await contractIn.populateTransaction.approve(V3_SWAP_ROUTER_ADDRESS, amountIn);
    // by default chainid is not set https://ethereum.stackexchange.com/questions/94412/valueerror-code-32000-message-only-replay-protected-eip-155-transac
    approveTxUnsigned.chainId = chainId;
    // estimate gas required to make approve call (not sending it to blockchain either)
    approveTxUnsigned.gasLimit = await contractIn.estimateGas.approve(V3_SWAP_ROUTER_ADDRESS, amountIn);
    // suggested gas price (increase if you want faster execution)
    approveTxUnsigned.gasPrice = await provider.getGasPrice();
    // nonce is the same as number previous transactions
    approveTxUnsigned.nonce = await provider.getTransactionCount(walletAddress);

    // sign transaction by our signer
    const approveTxSigned = await signer.signTransaction(approveTxUnsigned);
    // submit transaction to blockchain
    const submittedTx = await provider.sendTransaction(approveTxSigned);
    // wait till transaction completes
    const approveReceipt = await submittedTx.wait();
    if (approveReceipt.status === 0)
        throw new Error("Approve transaction failed");


    console.log("Making a swap...");
    const value = BigNumber.from(route.methodParameters.value);

    const transaction = {
        data: route.methodParameters.calldata,
        to: V3_SWAP_ROUTER_ADDRESS,
        value: value,
        from: walletAddress,
        gasPrice: route.gasPriceWei,

        // route.estimatedGasUsed might be too low!
        // most of swaps I tested fit into 300,000 but for some complex swaps this gas is not enough.
        // Loot at etherscan/polygonscan past results.
        gasLimit: BigNumber.from("800000")
    };

    var tx = await signer.sendTransaction(transaction);
    const receipt = await tx.wait();
    if (receipt.status === 0) {
        throw new Error("Swap transaction failed");
    }

    // ============= Final part --- printing results
    const [newBalanceIn, newBalanceOut] = await Promise.all([
        contractIn.balanceOf(walletAddress),
        contractOut.balanceOf(walletAddress)
    ]);

    console.log('');
    console.log('Swap completed successfully! ');
    console.log('');
    console.log('Updated balances:');
    console.log(`   ${tokenIn.symbol}: ${ethers.utils.formatUnits(newBalanceIn, tokenIn.decimals)}`);
    console.log(`   ${tokenOut.symbol}: ${ethers.utils.formatUnits(newBalanceOut, tokenOut.decimals)}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
