# Uniswap V3 SDK tutorial in TypeScript, Ethers.js
Swapping tokens on EVM-compatible blockchains: Mainnet, Polygon, testnets Goerli, Rinkeby. You can read [blog post](https://techgeorgii.com/uniswap-v3-sdk-tutorial) on this tutorial with detailed explanation.
\
\
To run this example:

1. `npm install` to install dependencies.
2. Customize **package.json**. Basically, you need to change 5 parameters of run task from `scripts` section
   1. `--chain-id`          is chain ID of Ethereum chain you work with.
   2. `--amount-in`         amount of input token you want to swap. Change according to your balance – there is no check
   3. `--token-in-address`  smart contract address of input token
   4. `--token-out-address` smart contract address of output token
   5. `--wallet-address`    your actual wallet address – replace `[YOUR_WALLET_ADDRESS]`.


   In scripts sections you can see sample configurations for few networks (`start-matic, start-rinkeby, start-goerli`). In `scripts-comments` sections you'll find descriptions of each configuration.
3. Create **.env** file and put up there the following code according to network you gonna use:

    ```
    API_URL = "API_URL from https://www.alchemy.com"
    PRIVATE_KEY = "WALLET_PRIVATE_KEY"
    ```

    Replace `API_URL` with URL from [Alchemy](https://www.alchemy.com), `WALLET_PRIVATE_KEY` by your wallet' private key (you can get it from Metamask).

    (Don't publish these keys anywhere in public!)

4. Run configuration for certain network, e.g. `npm run start-matic` for Matic (Polygon) network.
   Please note the tutorial is for demostration purposes and it misses lots of checks.


\
Happy hacking!

If you have a question or something does not work, you can ask in comment section in [my blog](https://techgeorgii.com/uniswap-v3-sdk-tutorial) or post an [issue](https://github.com/TechGeorgii/uniswap-v3-sdk-tutorial-ts/issues).