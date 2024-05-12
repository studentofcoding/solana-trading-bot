import { Filter, FilterResult } from './pool-filters';
import { LiquidityPoolKeysV4, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { Connection, PublicKey, RpcResponseAndContext,TokenAccountBalancePair } from '@solana/web3.js';
import { logger } from '../helpers';

export class TopHoldersFilter implements Filter {
  constructor(
    private readonly connection: Connection,
    private readonly quoteToken: Token,
    private readonly topN: number, // 指定要获取的持仓排名数量，这里设置为10
  ) {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      // 获取代币账户的持仓排名列表
      const response: RpcResponseAndContext<TokenAccountBalancePair[]> = await this.connection.getTokenLargestAccounts(
        poolKeys.lpMint,// 使用池子的quoteVault地址
        this.connection.commitment 
      );

      // 从RpcResponseAndContext对象中解构出TokenAccountBalancePair数组
      const accounts: TokenAccountBalancePair[] = response.value;

      // 检查是否有足够的账户信息
      if (accounts.length >= this.topN) {
        // 假设我们只关心前N个持仓账户的总和是否满足条件

        const topHoldersSum: TokenAmount = accounts
          .slice(0, this.topN)
          .reduce<TokenAmount>(
            (sum: TokenAmount, account: TokenAccountBalancePair): TokenAmount => {
              // 这里需要将account的amount转换为quoteToken的TokenAmount
              const accountAmount = new TokenAmount(this.quoteToken, account.amount, true);
              return sum.add(accountAmount);
            },
            new TokenAmount(this.quoteToken, 0, true) // 初始化sum为0
          );

        const isTopHolders = this.isGreaterThan(topHoldersSum,new TokenAmount(this.quoteToken, 0, true)); // 这里可以根据需要设置条件

        return {
          ok: isTopHolders,
          message: isTopHolders
            ? `TopHolders -> Top ${this.topN} holders qualify`
            : `TopHolders -> Top ${this.topN} holders do not qualify`,
        };
      } else {
        return { ok: false, message: `TopHolders -> Not enough accounts to check top ${this.topN}` };
      }
    } catch (error) {
      logger.error({ mint: poolKeys.baseMint }, `Failed to get top holders`);
      return { ok: false, message: 'TopHolders -> Failed to get top holders' };
    }
  }
  // 一个简单的比较函数，用于比较两个TokenAmount对象的大小
  isGreaterThan(a: TokenAmount, b: TokenAmount): boolean {
    return a.raw.gt(b.raw);
  }
}