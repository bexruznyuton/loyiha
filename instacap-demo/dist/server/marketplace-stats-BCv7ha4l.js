import { p as prisma } from "./node-build.mjs";
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1e3;
function startOfTashkentDay(daysAgo = 0) {
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const y = nowTashkent.getUTCFullYear();
  const m = nowTashkent.getUTCMonth();
  const d = nowTashkent.getUTCDate() - daysAgo;
  return new Date(Date.UTC(y, m, d) - TASHKENT_OFFSET_MS);
}
function toStatusMap(rows) {
  const map = {};
  for (const row of rows) map[row.status] = row._count._all;
  return map;
}
async function getAccountApplicationStats() {
  const todayStart = startOfTashkentDay(0);
  const weekStart = startOfTashkentDay(7);
  const [createdToday, createdWeek, createdAll, byStatus] = await Promise.all([
    prisma.adAccount.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.adAccount.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.adAccount.count(),
    prisma.adAccount.groupBy({ by: ["status"], _count: { _all: true } })
  ]);
  return {
    createdToday,
    createdWeek,
    createdAll,
    byStatus: toStatusMap(byStatus)
  };
}
async function getOrderStats() {
  const todayStart = startOfTashkentDay(0);
  const weekStart = startOfTashkentDay(7);
  const [
    createdToday,
    createdWeek,
    createdAll,
    byStatus,
    completedToday,
    completedWeek,
    completedAll,
    buyersToday,
    buyersAll
  ] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.order.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.order.count(),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.count({ where: { completedAt: { gte: todayStart } } }),
    prisma.order.count({ where: { completedAt: { gte: weekStart } } }),
    prisma.order.count({ where: { status: "COMPLETED" } }),
    prisma.order.findMany({
      where: { createdAt: { gte: todayStart } },
      select: { advertiserId: true },
      distinct: ["advertiserId"]
    }),
    prisma.order.findMany({ select: { advertiserId: true }, distinct: ["advertiserId"] })
  ]);
  return {
    createdToday,
    createdWeek,
    createdAll,
    completedToday,
    completedWeek,
    completedAll,
    byStatus: toStatusMap(byStatus),
    uniqueBuyersToday: buyersToday.length,
    uniqueBuyersAll: buyersAll.length
  };
}
export {
  getAccountApplicationStats,
  getOrderStats
};
//# sourceMappingURL=marketplace-stats-BCv7ha4l.js.map
