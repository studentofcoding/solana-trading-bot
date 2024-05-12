import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, SnipeListCache, BlackListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, logger, NETWORK, sleep } from './helpers';
import { Semaphore } from 'async-mutex';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
import TelegramBot from 'node-telegram-bot-api';

export interface BotConfig {
  wallet: Keypair;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  maxTokensAtTheTime: number;
  useSnipeList: boolean;
  useBlackList: boolean;
  autoSell: boolean;
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: number;
  stopLoss: number;
  trailingStopLoss: boolean;
  skipSellingIfLostMoreThan: number;
  buySlippage: number;
  sellSlippage: number;
  timesOutSell: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
}

export class Bot {
  // snipe list
  public snipeListCache?: SnipeListCache;

  // Blacklist
  // private readonly blackListCache?: BlackListCache;

  private readonly semaphore: Semaphore;
  private sellExecutionCount = 0;
  private readonly stopLoss = new Map<string, TokenAmount>();
  public readonly isWarp: boolean = false;
  public readonly isJito: boolean = false;

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
  ) {
    this.isWarp = txExecutor instanceof WarpTransactionExecutor;
    this.isJito = txExecutor instanceof JitoTransactionExecutor;
    this.semaphore = new Semaphore(config.maxTokensAtTheTime);

    if (this.config.useSnipeList) {
      this.snipeListCache = new SnipeListCache();
      this.snipeListCache.init();
      // this.runCopyTrade();
    }
  }

  async validate() {
    try {
      await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
    } catch (error) {
      logger.error(
        `${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
      );
      return false;
    }

    return true;
  }

  // private async runCopyTrade() {
  //    // Constants
  //    const WSS_ENDPOINT = `wss://mainnet.helius-rpc.com/?api-key=da09372d-8b31-4fb9-bbbc-32f430c370ec`;
  //    const HTTP_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=da09372d-8b31-4fb9-bbbc-32f430c370ec`;
 
  //    // const WSS_ENDPOINT = `wss://rpc.shyft.to?api_key=dt_BAV8lwogCz_vn`;
  //    // const HTTP_ENDPOINT = `https://rpc.shyft.to?api_key=dt_BAV8lwogCz_vn`;
 
  //    const solanaConnection = new Connection(HTTP_ENDPOINT, { wsEndpoint: WSS_ENDPOINT });
 
  //    const botToken = '7151376983:AAEnyVqUOKVh7YcPhSOD282iIJALvJ8E8lc';
  //    const chatId = '391032509'; // Chat ID where you want to send the message
 
  //    const bot = new TelegramBot(botToken, { polling: false });
 
  //    // INFO: Done, the Benchmark is 1.5 seconds
  //    /**
  //     * Done, the Benchmark is Cielo Wallet, got the same or less is Great
  //     * < 1.5 Seconds for Solana Tx
  //     * < 3 Seconds for Posting to Telegram
  //     */
  //    (async () => {
  //        const accountPublicKey = new PublicKey('2gKXoChNdN3LpMijfLdx4AVs62JBseXTHtrqxCSYreWs');
  //        let subscriptionId: number;
  //        let lastInitialTxSignature: string;
 
  //        const fetchTransactions = async () => {
  //            let transactionList = await solanaConnection.getSignaturesForAddress(accountPublicKey, {limit: 1}); // Fetch 2 transactions
  //            lastInitialTxSignature = transactionList[0].signature;
  //            console.log(`Last Initial tx: ${JSON.stringify(lastInitialTxSignature, null, 2)}`);
  //        }
 
  //        await fetchTransactions();
 
  //        try {
  //            subscriptionId = await solanaConnection.onAccountChange(
  //                accountPublicKey,
  //                async (updatedAccountInfo) => {
  //                    console.log(`--- Event Notification for ${accountPublicKey.toString()} ---`);
  //                    console.log(`New Account Balance: ${updatedAccountInfo.lamports / LAMPORTS_PER_SOL} SOL`);
                     
  //                    let startTimeSolanaTx = Date.now(); // Start measuring time
  //                    let transactionList = await solanaConnection.getSignaturesForAddress(accountPublicKey, {limit: 1}, 'confirmed'); // Fetch 2 transactions
  //                    // console.log(`Last tx: ${JSON.stringify(transactionList, null, 2)}`);
  //                    let latestTxSignature = transactionList[0].signature;
  //                    const transaction = transactionList[0]; // Get the latest transaction
 
  //                    // Handle same Tx Signature
  //                    while (latestTxSignature === lastInitialTxSignature) {
  //                        // Retry fetching after a delay
  //                        console.log(`Latest tx still the same: ${JSON.stringify(latestTxSignature, null, 2)}`);
  //                        await new Promise(resolve => setTimeout(resolve, 1000)); // Delay in milliseconds
  //                        transactionList = await solanaConnection.getSignaturesForAddress(accountPublicKey, {limit: 1}, 'confirmed'); // Fetch 2 transactions
  //                        latestTxSignature = transactionList[0].signature;
  //                    }
 
  //                    console.log(`Latest tx are updated: ${JSON.stringify(latestTxSignature, null, 2)}`);
 
  //                    lastInitialTxSignature = latestTxSignature;
 
  //                    console.log(`Signature now: ${lastInitialTxSignature}`);
  //                    let endTimeSolanaTx = Date.now(); // End measuring time
  //                    console.log(`Time taken to Solana Tx: ${endTimeSolanaTx - startTimeSolanaTx} ms`);
                     
  //                    var myHeaders = new Headers();
  //                    myHeaders.append("x-api-key", "dt_BAV8lwogCz_vn");
                     
  //                    let startTimeParsedTx = Date.now(); // Start measuring time
  //                    await fetch(`https://api.shyft.to/sol/v1/transaction/parsed?network=mainnet-beta&txn_signature=${latestTxSignature}`, { 
  //                        method: 'GET',
  //                        headers: myHeaders,
  //                        redirect: 'follow' as RequestRedirect
  //                    })
  //                        .then(response => response.json())
  //                        .then((tx_parsed_data) => {
  //                            if (transaction && transaction.blockTime) {
  //                              const date = new Date(transaction.blockTime * 1000);
  //                              console.log(`Signature: ${transaction.signature}`);
  //                              console.log(`Time: ${date}`);
  //                            }
                     
  //                            if (tx_parsed_data.result.type === 'SWAP' && tx_parsed_data.result.status === 'Success') {
  //                                let message;
  //                                let swap_data = tx_parsed_data.result.actions[0].info;
  //                                console.log(`Swap Data: ${JSON.stringify(swap_data, null, 2)}`);
 
  //                                let tokenBoughtAddress = swap_data.tokens_swapped.out.token_address;
                     
  //                                if (swap_data.tokens_swapped.in.token_address === 'So11111111111111111111111111111111111111112') {
  //                                 if (this.snipeListCache && !this.snipeListCache.snipeList.includes(tokenBoughtAddress)) {
  //                                   this.snipeListCache.snipeList.push(tokenBoughtAddress);
  //                                   logger.info(`Added ${tokenBoughtAddress} to snipe list`);
  //                                 }
  //                                  message = `
  //                                  BUY:\n
  //                                  ${swap_data.swapper} just BUY ${swap_data.tokens_swapped.in.amount} ${swap_data.tokens_swapped.in.symbol} (${swap_data.tokens_swapped.in.token_address}) with ${swap_data.tokens_swapped.out.amount} ${swap_data.tokens_swapped.out.symbol} (${swap_data.tokens_swapped.out.token_address})\n
  //                                  Info: Added ${tokenBoughtAddress} to snipe list`;
  //                                } else {
  //                                  message = `
  //                                  SELL:\n
  //                                  ${swap_data.swapper} just SELL ${swap_data.tokens_swapped.in.amount} ${swap_data.tokens_swapped.in.symbol} (${swap_data.tokens_swapped.in.token_address}) with ${swap_data.tokens_swapped.out.amount} ${swap_data.tokens_swapped.out.symbol} (${swap_data.tokens_swapped.out.token_address})\n
  //                                  Info: Remove ${tokenBoughtAddress} from snipe list`;
  //                                }
                     
  //                                bot.sendMessage(chatId, message)
  //                                    .then(() => {
  //                                        console.log('Message sent to Telegram');
  //                                        let endTimeParsedTx = Date.now(); // Stop measuring time
  //                                        console.log(`Time taken to Parsed Tx: ${endTimeParsedTx - startTimeParsedTx} ms`);
  //                                    })
  //                                    .catch((error: Error) => console.error('Error sending message to Telegram:', error));
  //                            }
 
                   
  //                        })
  //                        .catch(error => console.log('error', error));
  //                },
  //                "processed"
  //            );
  //            // console.log('Starting web socket, subscription ID: ', subscriptionId);
  //            logger.trace(`Starting copy transaction websocket: ${subscriptionId}`);
  //        } catch (error) {
  //            console.error('Error setting up account change subscription:', error);
  //        }
  //      console.log(("-").repeat(20));
  //    })();
  // }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4) {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);

    if (this.config.useSnipeList && !this.snipeListCache?.isInList(poolState.baseMint.toString())) {
      logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy because token is not in a snipe list`);
      return;
    }

    // if (this.blackListCache?.isBlacklisted(poolState.baseMint.toString())) {
    //   logger.info(`Skipping buy for blacklisted token: ${poolState.baseMint.toString()}`);
    //   return;
    // }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: poolState.baseMint }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await sleep(this.config.autoBuyDelay);
    }

    const numberOfActionsBeingProcessed =
      this.config.maxTokensAtTheTime - this.semaphore.getValue() + this.sellExecutionCount;
    if (this.semaphore.isLocked() || numberOfActionsBeingProcessed >= this.config.maxTokensAtTheTime) {
      logger.debug(
        { mint: poolState.baseMint.toString() },
        `Skipping buy because max tokens to process at the same time is ${this.config.maxTokensAtTheTime} and currently ${numberOfActionsBeingProcessed} tokens is being processed`,
      );
      return;
    }

    await this.semaphore.acquire();

    try {
      const [market, mintAta] = await Promise.all([
        this.marketStorage.get(poolState.marketId.toString()),
        getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
      ]);
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

      if (!this.config.useSnipeList) {
        const match = await this.filterMatch(poolKeys);

        if (!match) {
          logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
          return;
        }
      }

      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          const result = await this.swap(
            poolKeys,
            this.config.quoteAta,
            mintAta,
            this.config.quoteToken,
            tokenOut,
            this.config.quoteAmount,
            this.config.buySlippage,
            this.config.wallet,
            'buy',
          );

          if (result.confirmed) {
            logger.info(
              {
                mint: poolState.baseMint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed buy tx`,
            );

            if (this.config.useSnipeList) {
              const snipeList = new SnipeListCache();
              snipeList.init();
              snipeList.removeFromList(poolState.baseMint.toString());

              logger.info(`Removed ${poolState.baseMint.toString()} from snipe list as it's buyed!`);
            }

            break;
          }

          logger.info(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          );
        } catch (error) {
          logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
    } finally {
      this.semaphore.release();
    }
  }

  public async sell(accountId: PublicKey, rawAccount: RawAccount, amountToSellPercentage:number) {
    this.sellExecutionCount++;

    try {
      logger.trace({ mint: rawAccount.mint }, `Processing new token...`);

      const poolData = await this.poolStorage.get(rawAccount.mint.toString());

      if (!poolData) {
        logger.trace({ mint: rawAccount.mint.toString() }, `Token pool data is not found, can't sell`);
        this.sellExecutionCount--;
        return;
      }

      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
        this.sellExecutionCount--;
        return;
      }

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: rawAccount.mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(poolData.state.marketId.toString());
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

      for (let i = 0; i < this.config.maxSellRetries; i++) {
        try {
          const shouldSell = await this.waitForSellSignal(tokenAmountIn, poolKeys);

          if (!shouldSell) {
            return;
          }

          logger.info(
            { mint: rawAccount.mint },
            `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
          );

          const amountToSell = tokenAmountIn.raw.muln(amountToSellPercentage).divn(100);
          const tokenAmountToSell = new TokenAmount(tokenIn, amountToSell, true);

          const result = await this.swap(
            poolKeys,
            accountId,
            this.config.quoteAta,
            tokenIn,
            this.config.quoteToken,
            tokenAmountToSell,
            this.config.sellSlippage,
            this.config.wallet,
            'sell',
          );

          if (result.confirmed) {
            logger.info(
              {
                dex: `https://dexscreener.com/solana/${rawAccount.mint.toString()}?maker=${this.config.wallet.publicKey}`,
                mint: rawAccount.mint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed sell tx`,
            );
            break;
          }

          logger.info(
            {
              mint: rawAccount.mint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming sell tx`,
          );
        } catch (error) {
          logger.debug({ mint: rawAccount.mint.toString(), error }, `Error confirming sell transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
    } finally {
      this.sellExecutionCount--;
    }
  }

  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...(this.isWarp || this.isJito
          ? []
          : [
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
            ]),
        ...(direction === 'buy'
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ataOut,
                wallet.publicKey,
                tokenOut.mint,
              ),
            ]
          : []),
        ...innerTransaction.instructions,
        ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }

  private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
      return true;
    }

    const filters = new PoolFilters(this.connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
    });

    const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
    let timesChecked = 0;
    let matchCount = 0;

    do {
      try {
        const shouldBuy = await filters.execute(poolKeys);

        if (shouldBuy) {
          matchCount++;

          if (this.config.consecutiveMatchCount <= matchCount) {
            logger.debug(
              { mint: poolKeys.baseMint.toString() },
              `Filter match ${matchCount}/${this.config.consecutiveMatchCount}`,
            );
            return true;
          }
        } else {
          matchCount = 0;
        }

        await sleep(this.config.filterCheckInterval);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    return false;
  }

  private async waitForSellSignal(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
        return true;
    }

    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);
    let stopLoss: TokenAmount;

    if (!this.stopLoss.get(poolKeys.baseMint.toString())) {
        const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
        const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
        stopLoss = this.config.quoteAmount.subtract(lossAmount);

        this.stopLoss.set(poolKeys.baseMint.toString(), stopLoss);
    } else {
        stopLoss = this.stopLoss.get(poolKeys.baseMint.toString())!;
    }

    const slippage = new Percent(this.config.sellSlippage, 100);
    let timesChecked = 0;
    let sellSignal = false;

    do {
        try {
            const poolInfo = await Liquidity.fetchInfo({
                connection: this.connection,
                poolKeys,
            });

            let timesAfterLastCheck = 0;

            const amountOut = Liquidity.computeAmountOut({
                poolKeys,
                poolInfo,
                amountIn: amountIn,
                currencyOut: this.config.quoteToken,
                slippage,
            }).amountOut as TokenAmount;

            if (this.config.trailingStopLoss) {
                const trailingLossFraction = amountOut.mul(this.config.stopLoss).numerator.div(new BN(100));
                const trailingLossAmount = new TokenAmount(this.config.quoteToken, trailingLossFraction, true);
                const trailingStopLoss = amountOut.subtract(trailingLossAmount);

                if (trailingStopLoss.gt(stopLoss)) {
                    logger.trace(
                        { mint: poolKeys.baseMint.toString() },
                        `Updating trailing stop loss from ${stopLoss.toFixed()} to ${trailingStopLoss.toFixed()}`,
                    );
                    this.stopLoss.set(poolKeys.baseMint.toString(), trailingStopLoss);
                    stopLoss = trailingStopLoss;
                }
            }

            if (this.config.skipSellingIfLostMoreThan > 0) {
                const stopSellingFraction = this.config.quoteAmount
                    .mul(this.config.skipSellingIfLostMoreThan)
                    .numerator.div(new BN(100));

                const stopSellingAmount = new TokenAmount(this.config.quoteToken, stopSellingFraction, true);

                if (amountOut.lt(stopSellingAmount)) {
                    logger.debug(
                        { mint: poolKeys.baseMint.toString() },
                        `Token dropped more than ${this.config.skipSellingIfLostMoreThan}%, sell stopped. Initial: ${this.config.quoteAmount.toFixed()} | Current: ${amountOut.toFixed()}`,
                    );
                    this.stopLoss.delete(poolKeys.baseMint.toString());
                    return false;
                }
            }

            logger.debug(
                { mint: poolKeys.baseMint.toString() },
                `Take profit: ${takeProfit.toFixed()} | Stop loss: ${stopLoss.toFixed()} | Current: ${amountOut.toFixed()}`,
                timesAfterLastCheck+1,
                `Time hold: ${timesAfterLastCheck} seconds`,
            );

            if (timesAfterLastCheck >= this.config.timesOutSell) {
              sellSignal = true;
              logger.debug(sellSignal, `Sold after timeout of ${this.config.timesOutSell} s`);
              break;
            }

            if (amountOut.lt(stopLoss)) {
                this.stopLoss.delete(poolKeys.baseMint.toString());
                sellSignal = true;
                break;
            }

            if (amountOut.gt(takeProfit)) {
                this.stopLoss.delete(poolKeys.baseMint.toString());
                sellSignal = true;
                break;
            }

            await sleep(this.config.priceCheckInterval);
        } catch (e) {
            logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
        } finally {
            timesChecked++;
        }
    } while (timesChecked < timesToCheck);

    return sellSignal;
  }
}
