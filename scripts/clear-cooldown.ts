import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Clear freelancer cooldown & strikes
  const freelancerUser = await prisma.user.findUnique({
    where: { email: 'dhanshreeshinde276@gmail.com' },
    include: { freelancer: true },
  });

  if (freelancerUser?.freelancer) {
    await prisma.freelancer.update({
      where: { id: freelancerUser.freelancer.id },
      data: {
        cancellationStrikes: 0,
        cooldownExpiresAt: null,
      },
    });
    console.log('Freelancer dhanshreeshinde276@gmail.com: strikes=0, cooldown=null');
  } else {
    console.log('Freelancer not found');
  }

  // 2. Clear client pending penalty
  const clientUser = await prisma.user.findUnique({
    where: { email: 'dhanshreeshinde2003@gmail.com' },
    include: { client: true },
  });

  if (clientUser?.client) {
    await prisma.client.update({
      where: { id: clientUser.client.id },
      data: {
        pendingPenaltyAmount: 0,
      },
    });
    console.log('Client dhanshreeshinde2003@gmail.com: pendingPenalty=0');
  } else {
    console.log('Client not found');
  }

  // 3. Verify
  const f = await prisma.freelancer.findUnique({ where: { id: freelancerUser?.freelancer?.id } });
  const c = await prisma.client.findUnique({ where: { id: clientUser?.client?.id } });
  console.log('\n=== Verification ===');
  console.log('Freelancer strikes:', f?.cancellationStrikes, '| cooldown:', f?.cooldownExpiresAt);
  console.log('Client pendingPenalty:', c?.pendingPenaltyAmount?.toString());

  await prisma.$disconnect();
}

main().catch(console.error).finally(() => prisma.$disconnect());
