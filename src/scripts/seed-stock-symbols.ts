import { PrismaClient } from '@prisma/client';
import { stockSymbols } from '../lib/stock-symbols';

const prisma = new PrismaClient();

async function seedStockSymbols() {
  console.log('🌱 Seeding stock symbols...');

  try {
    let created = 0;

    for (const symbolData of stockSymbols) {
      await prisma.symbol.upsert({
        where: {
          ticker_exchange: {
            ticker: symbolData.ticker,
            exchange: symbolData.exchange,
          },
        },
        update: {
          kind: symbolData.kind as any,
          meta: {
            name: symbolData.name,
            sector: symbolData.sector,
          },
        },
        create: {
          ticker: symbolData.ticker,
          exchange: symbolData.exchange,
          kind: symbolData.kind as any,
          meta: {
            name: symbolData.name,
            sector: symbolData.sector,
          },
        },
      });

      created++; // 단순화: 모든 처리를 created로 카운트
    }

    console.log(`✅ Successfully processed ${stockSymbols.length} symbols`);
    console.log(`📈 Processed: ${created}`);

    // 데이터베이스 통계 출력
    const totalSymbols = await prisma.symbol.count();
    const symbolsByKind = await prisma.symbol.groupBy({
      by: ['kind'],
      _count: true,
    });

    console.log(`\n📊 Database Statistics:`);
    console.log(`Total symbols: ${totalSymbols}`);
    symbolsByKind.forEach(stat => {
      console.log(`${stat.kind}: ${stat._count}`);
    });
  } catch (error) {
    console.error('❌ Error seeding symbols:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 스크립트가 직접 실행될 때만 시드 실행
if (require.main === module) {
  seedStockSymbols()
    .then(() => {
      console.log('🎉 Symbol seeding completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Symbol seeding failed:', error);
      process.exit(1);
    });
}

export { seedStockSymbols };
