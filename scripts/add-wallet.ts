import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'dhanshreeshinde276@gmail.com';
  const amount = 10000;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { client: true, freelancer: true },
  });

  if (!user) {
    console.log('User not found');
    return;
  }

  console.log('User:', user.id, user.email);

  if (user.client) {
    const before = await prisma.client.findUnique({ where: { id: user.client.id } });
    console.log('Client wallet before:', before?.wallet.toString());
    await prisma.client.update({
      where: { id: user.client.id },
      data: { wallet: { increment: amount } },
    });
    const after = await prisma.client.findUnique({ where: { id: user.client.id } });
    console.log('Client wallet after:', after?.wallet.toString());
  }

  if (user.freelancer) {
    const before = await prisma.freelancer.findUnique({ where: { id: user.freelancer.id } });
    console.log('Freelancer withdrawable before:', before?.withdrawableAmount.toString());
    await prisma.freelancer.update({
      where: { id: user.freelancer.id },
      data: { withdrawableAmount: { increment: amount } },
    });
    const after = await prisma.freelancer.findUnique({ where: { id: user.freelancer.id } });
    console.log('Freelancer withdrawable after:', after?.withdrawableAmount.toString());
  }

  console.log('Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
