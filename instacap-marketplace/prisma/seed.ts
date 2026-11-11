import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helperlar: deterministik public URL'lar
const avatar = (seed: string) => `https://i.pravatar.cc/400?u=${encodeURIComponent(seed)}`;
const shot = (seed: string, w = 600, h = 800) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;

async function main() {
  const adminTgIdStr = (process.env.ADMIN_TELEGRAM_IDS || '').split(',')[0]?.trim();
  const adminTgId = adminTgIdStr ? BigInt(adminTgIdStr) : BigInt(123456789);

  // Admin
  const admin = await prisma.user.upsert({
    where: { telegramId: adminTgId },
    update: { role: 'ADMIN' },
    create: {
      telegramId: adminTgId,
      firstName: 'Admin',
      lastName: 'InstaCap',
      username: 'instacap_admin',
      role: 'ADMIN',
    },
  });
  await prisma.wallet.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id },
    update: {},
  });

  // 17 demo OWNER va akkaunt
  type Demo = {
    tg: number;
    first: string;
    last: string;
    user: string;
    ig: string;
    niche:
      | 'LIFESTYLE'
      | 'BEAUTY'
      | 'FOOD'
      | 'SPORT'
      | 'AUTO'
      | 'BUSINESS'
      | 'EDUCATION'
      | 'ENTERTAINMENT'
      | 'TECH'
      | 'OTHER';
    desc: string;
    followers: number;
    avgReels: number;
    storyViews: number;
    er: number;
    priceStory: number;
    priceReels: number;
    priceFeed: number;
    guaranteed: number;
    verified: boolean;
    rating: number;
    completed: number;
    shotCount: number;
  };

  const demos: Demo[] = [
    {
      tg: 1001001001, first: 'Maftuna', last: 'Yusupova', user: 'maftuna_style',
      ig: 'maftuna.style', niche: 'LIFESTYLE',
      desc: "Lifestyle blogger — moda, sayohat, beauty. Auditoriya: 18–35 yosh ayollar.",
      followers: 120_000, avgReels: 80_000, storyViews: 25_000, er: 4.2,
      priceStory: 80_000, priceReels: 250_000, priceFeed: 150_000, guaranteed: 15_000,
      verified: true, rating: 4.8, completed: 38, shotCount: 4,
    },
    {
      tg: 1001001002, first: 'Aziz', last: 'Toshmatov', user: 'aziz_cooks',
      ig: 'aziz.cooks', niche: 'FOOD',
      desc: "Pazandachilik va restoran reviewlar — milliy + xalqaro taomlar.",
      followers: 85_000, avgReels: 55_000, storyViews: 18_000, er: 5.8,
      priceStory: 50_000, priceReels: 150_000, priceFeed: 90_000, guaranteed: 10_000,
      verified: false, rating: 4.6, completed: 22, shotCount: 3,
    },
    {
      tg: 1001001003, first: 'Bek', last: 'Rahimov', user: 'gym_bek',
      ig: 'gym.with.bek', niche: 'SPORT',
      desc: "Fitness va sport blogger. Workout, nutrition, motivatsiya — 200K+ auditoriya.",
      followers: 210_000, avgReels: 150_000, storyViews: 45_000, er: 6.1,
      priceStory: 120_000, priceReels: 350_000, priceFeed: 200_000, guaranteed: 25_000,
      verified: true, rating: 4.9, completed: 54, shotCount: 5,
    },
    {
      tg: 1001001004, first: 'Malika', last: 'Nazarova', user: 'malika_beauty',
      ig: 'malika.beauty', niche: 'BEAUTY',
      desc: "Beauty + makeup. Skincare tutorial va mahsulot reviewlar.",
      followers: 95_000, avgReels: 65_000, storyViews: 22_000, er: 4.9,
      priceStory: 70_000, priceReels: 220_000, priceFeed: 130_000, guaranteed: 12_000,
      verified: true, rating: 4.7, completed: 31, shotCount: 4,
    },
    {
      tg: 1001001005, first: 'Jasur', last: 'Karimov', user: 'tashkent_eats',
      ig: 'tashkent.eats', niche: 'FOOD',
      desc: "Toshkent restorani va kafe sharhlari. Yangi ochilishlardan birinchi xabar.",
      followers: 140_000, avgReels: 95_000, storyViews: 28_000, er: 5.3,
      priceStory: 90_000, priceReels: 260_000, priceFeed: 160_000, guaranteed: 18_000,
      verified: false, rating: 4.5, completed: 19, shotCount: 3,
    },
    {
      tg: 1001001006, first: 'Sardor', last: 'Yo\'ldoshev', user: 'uzauto_life',
      ig: 'uzauto.life', niche: 'AUTO',
      desc: "Auto blogger — yangi modellar, test drive, narxlar, sotuv maslahatlari.",
      followers: 65_000, avgReels: 45_000, storyViews: 15_000, er: 7.2,
      priceStory: 40_000, priceReels: 130_000, priceFeed: 80_000, guaranteed: 8_000,
      verified: true, rating: 4.9, completed: 17, shotCount: 4,
    },
    {
      tg: 1001001007, first: 'Nodira', last: 'Egamberdieva', user: 'nodira_fashion',
      ig: 'nodira.fashion', niche: 'LIFESTYLE',
      desc: "Fashion + photoshoot. Toshkent dizaynerlar bilan kolloboratsiyalar.",
      followers: 175_000, avgReels: 110_000, storyViews: 35_000, er: 4.7,
      priceStory: 110_000, priceReels: 310_000, priceFeed: 180_000, guaranteed: 22_000,
      verified: true, rating: 4.8, completed: 41, shotCount: 5,
    },
    {
      tg: 1001001008, first: 'Diyor', last: 'Sobirov', user: 'diyor_tech',
      ig: 'diyor.tech', niche: 'TECH',
      desc: "Texnologiya, smartfon obzor va review. Yangi modellar haqida birinchi sharh.",
      followers: 78_000, avgReels: 60_000, storyViews: 20_000, er: 6.4,
      priceStory: 55_000, priceReels: 165_000, priceFeed: 100_000, guaranteed: 11_000,
      verified: false, rating: 4.6, completed: 14, shotCount: 3,
    },
    {
      tg: 1001001009, first: 'Lola', last: 'Abdullayeva', user: 'lola_mom',
      ig: 'lola.mom', niche: 'LIFESTYLE',
      desc: "Onalik va oilaviy hayot — bola tarbiyasi, sog'lom turmush.",
      followers: 105_000, avgReels: 72_000, storyViews: 24_000, er: 5.2,
      priceStory: 65_000, priceReels: 195_000, priceFeed: 115_000, guaranteed: 13_000,
      verified: false, rating: 4.7, completed: 26, shotCount: 4,
    },
    {
      tg: 1001001010, first: 'Otabek', last: 'Mansurov', user: 'otabek_business',
      ig: 'otabek.business', niche: 'BUSINESS',
      desc: "Biznes maslahatlar, startuplar, marketing. Tadbirkorlar uchun.",
      followers: 58_000, avgReels: 38_000, storyViews: 13_000, er: 7.8,
      priceStory: 35_000, priceReels: 115_000, priceFeed: 70_000, guaranteed: 7_000,
      verified: true, rating: 4.9, completed: 22, shotCount: 4,
    },
    {
      tg: 1001001011, first: 'Zarina', last: 'Otaboeva', user: 'zarina_recipe',
      ig: 'zarina.recipe', niche: 'FOOD',
      desc: "Uy retseptlari — tez va mazali. Step-by-step videolar.",
      followers: 132_000, avgReels: 88_000, storyViews: 26_000, er: 5.5,
      priceStory: 78_000, priceReels: 235_000, priceFeed: 140_000, guaranteed: 16_000,
      verified: true, rating: 4.8, completed: 33, shotCount: 5,
    },
    {
      tg: 1001001012, first: 'Bobur', last: 'Rashidov', user: 'bobur_travel',
      ig: 'bobur.travel', niche: 'LIFESTYLE',
      desc: "Sayohat blogger — O'zbekiston va xorij. Lokatsiyalar, tariflar.",
      followers: 89_000, avgReels: 62_000, storyViews: 19_000, er: 5.0,
      priceStory: 55_000, priceReels: 170_000, priceFeed: 105_000, guaranteed: 10_000,
      verified: false, rating: 4.5, completed: 16, shotCount: 3,
    },
    {
      tg: 1001001013, first: 'Saida', last: 'Kamilova', user: 'saida_skincare',
      ig: 'saida.skincare', niche: 'BEAUTY',
      desc: "Faqat skincare. Honest reviewlar va K-beauty maslahatlari.",
      followers: 72_000, avgReels: 50_000, storyViews: 17_000, er: 5.6,
      priceStory: 48_000, priceReels: 145_000, priceFeed: 88_000, guaranteed: 9_000,
      verified: false, rating: 4.6, completed: 12, shotCount: 4,
    },
    {
      tg: 1001001014, first: 'Rustam', last: 'Xolikov', user: 'rustam_fit',
      ig: 'rustam.fit', niche: 'SPORT',
      desc: "Home workout va sport oziq-ovqat. Mashqlar va plan'lar.",
      followers: 168_000, avgReels: 115_000, storyViews: 32_000, er: 5.9,
      priceStory: 100_000, priceReels: 290_000, priceFeed: 170_000, guaranteed: 20_000,
      verified: true, rating: 4.7, completed: 36, shotCount: 4,
    },
    {
      tg: 1001001015, first: 'Aziza', last: 'Ne\'matova', user: 'aziza_kids',
      ig: 'aziza.kids', niche: 'EDUCATION',
      desc: "Bolalar uchun ta'lim va o'yinlar. Onalar uchun maslahatlar.",
      followers: 94_000, avgReels: 70_000, storyViews: 21_000, er: 6.0,
      priceStory: 60_000, priceReels: 180_000, priceFeed: 110_000, guaranteed: 12_000,
      verified: false, rating: 4.8, completed: 28, shotCount: 4,
    },
    {
      tg: 1001001016, first: 'Davron', last: 'Aliyev', user: 'davron_music',
      ig: 'davron.music', niche: 'ENTERTAINMENT',
      desc: "Musiqa, klip va konsertlar. Yosh ijodkorlar uchun platforma.",
      followers: 245_000, avgReels: 180_000, storyViews: 50_000, er: 4.5,
      priceStory: 140_000, priceReels: 400_000, priceFeed: 230_000, guaranteed: 30_000,
      verified: true, rating: 4.6, completed: 47, shotCount: 5,
    },
    {
      tg: 1001001017, first: 'Madina', last: 'Saidova', user: 'madina_decor',
      ig: 'madina.decor', niche: 'LIFESTYLE',
      desc: "Interyer va uy bezatish. DIY g'oyalar, dekor mahsulotlari.",
      followers: 67_000, avgReels: 44_000, storyViews: 14_000, er: 6.8,
      priceStory: 42_000, priceReels: 125_000, priceFeed: 75_000, guaranteed: 8_000,
      verified: false, rating: 4.7, completed: 18, shotCount: 4,
    },
  ];

  for (const d of demos) {
    const owner = await prisma.user.upsert({
      where: { telegramId: BigInt(d.tg) },
      update: { role: 'OWNER' },
      create: {
        telegramId: BigInt(d.tg),
        firstName: d.first,
        lastName: d.last,
        username: d.user,
        role: 'OWNER',
      },
    });
    await prisma.wallet.upsert({
      where: { userId: owner.id },
      create: { userId: owner.id },
      update: {},
    });

    const screenshots = Array.from({ length: d.shotCount }, (_, i) =>
      shot(`${d.ig}-shot-${i + 1}`, 600, 800),
    );

    const baseData = {
      ownerId: owner.id,
      igUsername: d.ig,
      igProfileUrl: `https://instagram.com/${d.ig}`,
      avatarFileId: avatar(d.ig),
      niche: d.niche,
      region: 'Toshkent',
      description: d.desc,
      followers: d.followers,
      avgReelsViews: d.avgReels,
      storyViews: d.storyViews,
      engagementRate: d.er,
      priceStory: d.priceStory,
      priceReels: d.priceReels,
      priceFeed: d.priceFeed,
      guaranteedViews: d.guaranteed,
      status: 'ACTIVE' as const,
      isVerified: d.verified,
      rating: d.rating,
      completedOrders: d.completed,
      successRate: 100,
    };

    await prisma.adAccount.upsert({
      where: { igUsername: d.ig },
      update: {
        avatarFileId: avatar(d.ig),
        verificationScreenshots: screenshots,
        description: d.desc,
        followers: d.followers,
        rating: d.rating,
        completedOrders: d.completed,
        isVerified: d.verified,
        status: 'ACTIVE',
      },
      create: {
        ...baseData,
        verificationScreenshots: screenshots,
      },
    });
  }

  console.log(`✅ Seeded ${demos.length} accounts`);
}

main()
  .catch((e) => {
    console.error('Seed xatosi:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
