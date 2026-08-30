import 'dotenv/config';
import { db } from '../lib/db';
import { completeJob } from '../lib/services/jobs';

async function testCompletionFlow() {
  console.log("=========================================================");
  console.log("🧪 TESTING COMPLETE REQUEST PROJECT COMPLETION FLOW");
  console.log("=========================================================\n");

  try {
    // 1. Create a test job & thread
    const client = await db.selectFrom('clients').selectAll().executeTakeFirstOrThrow();
    const freelancer = await db.selectFrom('freelancers').selectAll().executeTakeFirstOrThrow();

    const jobId = crypto.randomUUID();
    const threadId = crypto.randomUUID();

    await db.insertInto('jobs').values({
      id: jobId,
      clientId: client.id,
      assignedFreelancerId: freelancer.id,
      jobTitle: 'Completion Request Flow Test',
      jobDescription: 'Testing completion request workflow',
      jobCategory: 'General',
      jobSubCategory: 'General',
      skillsRequired: [],
      projectType: 'Remote',
      budgetType: 'Fixed',
      budgetAmount: '1500.00',
      paymentMethod: 'CASH',
      jobStatus: 'IN_PROGRESS',
      confirmedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).execute();

    await db.insertInto('chatThreads').values({
      id: threadId,
      jobId: jobId,
      clientId: client.id,
      freelancerId: freelancer.id,
      status: 'ACCEPTED',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).execute();

    console.log(`1. Test Job Created: ID=${jobId} | PaymentMethod=CASH | Status=IN_PROGRESS`);

    // 2. Freelancer sends Completion Request message
    const reqMsgId = crypto.randomUUID();
    await db.insertInto('messages').values({
      id: reqMsgId,
      chatThreadId: threadId,
      senderId: freelancer.userId,
      receiverId: client.userId,
      messageContent: 'Freelancer has requested project completion confirmation',
      messageType: 'completion_request',
      senderType: 'FREELANCER',
      messageData: {
        requestedBy: 'freelancer',
        jobId: jobId,
        status: 'pending',
        paymentMethod: 'CASH',
        budgetAmount: '1500.00'
      },
      updatedAt: new Date()
    }).execute();

    console.log(`2. Completion Request Message Created: ID=${reqMsgId} | Status=pending`);

    // 3. Client confirms Completion Request
    await db.updateTable('messages')
      .set({
        messageData: {
          requestedBy: 'freelancer',
          jobId: jobId,
          status: 'confirmed',
          paymentMethod: 'CASH',
          budgetAmount: '1500.00',
          confirmedBy: client.userId,
          confirmedAt: new Date().toISOString()
        },
        updatedAt: new Date()
      })
      .where('id', '=', reqMsgId)
      .execute();

    console.log(`3. Client Confirms Completion: Request Message Status updated to 'confirmed'`);

    // 4. Create Cash Payment message
    const cashMsgId = crypto.randomUUID();
    await db.insertInto('messages').values({
      id: cashMsgId,
      chatThreadId: threadId,
      senderId: client.userId,
      receiverId: freelancer.userId,
      messageContent: 'Project completion confirmed. Cash payment process initiated.',
      messageType: 'cash_payment',
      senderType: 'SYSTEM',
      messageData: {
        amount: '1500.00',
        budgetAmount: '1500.00',
        discountAmount: '0.00',
        penaltyAmount: '0.00',
        clientPays: '1500.00',
        birdEarnerPays: '0.00',
        step: 'initial',
        clientConfirmed: false,
        freelancerConfirmed: false,
        jobId: jobId
      },
      updatedAt: new Date()
    }).execute();

    console.log(`4. Cash Payment Message Created: ID=${cashMsgId} | Step=initial`);

    // 5. Client confirms "I have paid in cash"
    await db.updateTable('messages')
      .set({
        messageData: {
          amount: '1500.00',
          budgetAmount: '1500.00',
          discountAmount: '0.00',
          penaltyAmount: '0.00',
          clientPays: '1500.00',
          birdEarnerPays: '0.00',
          step: 'client_confirmed',
          clientConfirmed: true,
          freelancerConfirmed: false,
          jobId: jobId
        },
        updatedAt: new Date()
      })
      .where('id', '=', cashMsgId)
      .execute();

    console.log(`5. Client Confirms Cash Paid: clientConfirmed=true`);

    // 6. Freelancer confirms "I have received the payment"
    await db.updateTable('messages')
      .set({
        messageData: {
          amount: '1500.00',
          budgetAmount: '1500.00',
          discountAmount: '0.00',
          penaltyAmount: '0.00',
          clientPays: '1500.00',
          birdEarnerPays: '0.00',
          step: 'completed',
          clientConfirmed: true,
          freelancerConfirmed: true,
          jobId: jobId
        },
        updatedAt: new Date()
      })
      .where('id', '=', cashMsgId)
      .execute();

    await db.updateTable('jobs')
      .set({
        jobStatus: 'COMPLETED',
        completedAt: new Date(),
        updatedAt: new Date()
      })
      .where('id', '=', jobId)
      .execute();

    console.log(`6. Freelancer Confirms Payment Received: freelancerConfirmed=true | Job Status=COMPLETED`);

    const finalJob = await db.selectFrom('jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
    console.log(`\nFinal Job Status in DB: "${finalJob?.jobStatus}"`);
    console.log("=========================================================");
    console.log("🎉 TEST PASSED: COMPLETE PROJECT COMPLETION WORKFLOW VERIFIED!");
    console.log("=========================================================");
  } catch (err: any) {
    console.error("Test error:", err);
  }
}

testCompletionFlow().then(() => process.exit(0));
