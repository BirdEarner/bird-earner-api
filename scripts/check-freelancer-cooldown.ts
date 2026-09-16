import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'dhanshreeshinde276@gmail.com';

  const user = await prisma.user.findUnique({
    where: { email },
    include: { freelancer: true },
  });

  if (!user || !user.freelancer) {
    console.log('Freelancer not found');
    return;
  }

  const f = user.freelancer;
  console.log('=== Freelancer Status ===');
  console.log('User:', user.email);
  console.log('Freelancer ID:', f.id);
  console.log('cancellationStrikes:', f.cancellationStrikes);
  console.log('cooldownExpiresAt:', f.cooldownExpiresAt?.toString() || 'null');
  console.log('totalPenaltyDeducted:', f.totalPenaltyDeducted.toString());
  console.log('totalPenaltyReceived:', f.totalPenaltyReceived.toString());

  const now = new Date();
  const cooldownExpiry = f.cooldownExpiresAt ? new Date(f.cooldownExpiresAt) : null;
  const isOnCooldown = cooldownExpiry ? cooldownExpiry > now : false;

  console.log('\n=== Cooldown Check ===');
  console.log('Current time:', now.toISOString());
  console.log('Cooldown expires:', cooldownExpiry?.toISOString() || 'N/A');
  console.log('Is on cooldown:', isOnCooldown);

  if (isOnCooldown && cooldownExpiry) {
    const remainingMs = cooldownExpiry.getTime() - now.getTime();
    const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
    console.log('Time remaining:', remainingHours, 'hours');
  }

  await prisma.$disconnect();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
