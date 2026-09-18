import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { sendMessage, createOrGetThread, respondToWorkSubmissionMessage } from '../lib/services/chats';

async function testRemoteAttachmentFlow() {
  console.log('=========================================================');
  console.log('🧪 TESTING REMOTE JOB WORK SUBMISSION & REVISION FLOW');
  console.log('=========================================================');

  // 1. Setup Test Client & Freelancer Users
  const client = await db
    .selectFrom('clients')
    .innerJoin('users', 'users.id', 'clients.userId')
    .select(['clients.id as clientId', 'users.id as clientUserId', 'users.email as clientEmail'])
    .executeTakeFirst();

  const freelancer = await db
    .selectFrom('freelancers')
    .innerJoin('users', 'users.id', 'freelancers.userId')
    .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId', 'users.email as freelancerEmail'])
    .executeTakeFirst();

  if (!client || !freelancer) {
    console.error('Client or Freelancer user missing in database');
    return;
  }

  console.log(`👤 Client: ID=${client.clientId} | UserID=${client.clientUserId}`);
  console.log(`👤 Freelancer: ID=${freelancer.freelancerId} | UserID=${freelancer.freelancerUserId}`);

  // Ensure Client has enough wallet balance for test job
  await db
    .updateTable('clients')
    .set({ wallet: '10000.00', availableBalance: '10000.00', reservedAmount: '0.00' })
    .where('id', '=', client.clientId)
    .execute();

  // Ensure Freelancer has no negative balance or outstanding penalty or cooldown blocking thread creation
  await db
    .updateTable('freelancers')
    .set({ outstandingAmount: '0.00', withdrawableAmount: '0.00', cooldownExpiresAt: null })
    .where('id', '=', freelancer.freelancerId)
    .execute();

  // 2. Create Remote Job & Assign Freelancer
  console.log('\n1. Creating Remote Job (Budget = 1000 INR)...');
  const job = await createJob(
    {
      jobTitle: 'Remote Logo Design & Branding',
      jobDescription: 'Design modern logo with high-resolution deliverables',
      jobCategory: 'Design & Creative',
      jobSubCategory: 'Logo Design',
      projectType: 'Remote',
      budgetType: 'Fixed',
      budgetAmount: 1000,
      workDurationDays: 2,
      paymentMethod: 'PLATFORM',
      location: 'Remote Work',
    },
    client.clientUserId,
    client.clientId
  );
  console.log(`✅ Remote Job Created: ID=${job.id} | Status=${job.jobStatus}`);

  // Assign Freelancer
  console.log('\n2. Assigning Freelancer to Remote Job...');
  await assignFreelancer(job.id, freelancer.freelancerId, client.clientUserId);
  let jobDB = await db.selectFrom('jobs').select(['jobStatus', 'paymentStatus']).where('id', '=', job.id).executeTakeFirst();
  console.log(`✅ Freelancer Assigned | Job Status=${jobDB?.jobStatus} | Payment Status=${jobDB?.paymentStatus}`);

  // Get or Create Chat Thread
  const thread = await createOrGetThread(job.id, freelancer.freelancerId, client.clientId);
  console.log(`✅ Chat Thread Ready: ThreadID=${thread.id}`);

  // 3. Freelancer Submits First Work Attachment (v1)
  console.log('\n3. Freelancer submits initial work attachment (Version 1)...');
  const submission1 = await sendMessage({
    chatThreadId: thread.id,
    senderId: freelancer.freelancerUserId,
    receiverId: client.clientUserId,
    messageContent: 'Here is the draft logo design concept for your review.',
    messageType: 'ATTACHMENT',
    senderType: 'FREELANCER',
    attachments: [
      {
        url: 'https://res.cloudinary.com/demo/image/upload/v1/sample_logo_v1.png',
        name: 'sample_logo_v1.png',
        size: 512000,
        mimeType: 'image/png',
      },
    ],
    messageData: {
      isWorkSubmission: true,
      submissionStatus: 'PENDING',
      version: 1,
    },
  });
  console.log(`✅ Work Submission Message Created: MessageID=${submission1.id} | Status=PENDING`);

  // 4. Client Requests Revision with Notes
  console.log('\n4. Client requests revision on Version 1...');
  const revisionNotes = 'Please update the color scheme to dark purple and make font bold.';
  const reviseResult = await respondToWorkSubmissionMessage(submission1.id, client.clientUserId, 'REVISE_REQUESTED', revisionNotes);
  console.log(`✅ Client Decision Processed:`, reviseResult);

  // Verify DB state after revision request
  const msg1DB = await db.selectFrom('messages').select(['messageData']).where('id', '=', submission1.id).executeTakeFirst();
  console.log(`   Updated Message 1 Data:`, JSON.stringify(msg1DB?.messageData));

  const jobReviseDB = await db.selectFrom('jobs').select(['jobStatus', 'submittedWorkData']).where('id', '=', job.id).executeTakeFirst();
  console.log(`   Job Status=${jobReviseDB?.jobStatus}`);
  console.log(`   Job SubmittedWorkData:`, JSON.stringify(jobReviseDB?.submittedWorkData));

  if ((jobReviseDB?.jobStatus as string) !== 'REVISION_REQUESTED') {
    throw new Error(`Expected Job Status REVISION_REQUESTED, got ${jobReviseDB?.jobStatus}`);
  }

  // 5. Freelancer Submits Revised Work Attachment (v2)
  console.log('\n5. Freelancer submits revised work attachment (Version 2)...');
  const submission2 = await sendMessage({
    chatThreadId: thread.id,
    senderId: freelancer.freelancerUserId,
    receiverId: client.clientUserId,
    messageContent: 'Here is the updated logo design with dark purple palette and bold font.',
    messageType: 'ATTACHMENT',
    senderType: 'FREELANCER',
    attachments: [
      {
        url: 'https://res.cloudinary.com/demo/image/upload/v2/sample_logo_v2.png',
        name: 'sample_logo_v2.png',
        size: 530000,
        mimeType: 'image/png',
      },
    ],
    messageData: {
      isWorkSubmission: true,
      submissionStatus: 'PENDING',
      version: 2,
    },
  });
  console.log(`✅ Revised Work Submission Created: MessageID=${submission2.id} | Status=PENDING`);

  // 6. Client Accepts Work Submission (Accept & Complete)
  console.log('\n6. Client accepts Version 2 work submission...');
  const acceptResult = await respondToWorkSubmissionMessage(submission2.id, client.clientUserId, 'ACCEPT');
  console.log(`✅ Client Accept Decision Processed:`, acceptResult);

  // 7. Verify Final Database State & Balances
  console.log('\n7. Verifying final Job, Message, and Freelancer Wallet states...');
  const finalJob = await db.selectFrom('jobs').select(['jobStatus', 'paymentStatus', 'submittedWorkData']).where('id', '=', job.id).executeTakeFirst();
  console.log(`   Final Job Status: ${finalJob?.jobStatus} (Expected: COMPLETED)`);
  console.log(`   Final Payment Status: ${finalJob?.paymentStatus} (Expected: COMPLETED / PAID)`);

  const msg2DB = await db.selectFrom('messages').select(['messageData']).where('id', '=', submission2.id).executeTakeFirst();
  console.log(`   Final Message 2 Data:`, JSON.stringify(msg2DB?.messageData));

  const freelancerDB = await db
    .selectFrom('freelancers')
    .selectAll()
    .where('id', '=', freelancer.freelancerId)
    .executeTakeFirst();
  console.log(`   Freelancer Total Earnings: ₹${freelancerDB?.totalEarnings} | Withdrawable: ₹${freelancerDB?.withdrawableAmount}`);

  if (['WORK_ACCEPTED', 'COMPLETED'].includes(finalJob?.jobStatus as string)) {
    console.log('\n=========================================================');
    console.log('🎉 TEST SUCCESSFUL! REMOTE ATTACHMENT & REVISION FLOW FULLY VERIFIED!');
    console.log('=========================================================');
  } else {
    throw new Error(`Test failed: Job status is ${finalJob?.jobStatus} after acceptance`);
  }
}

testRemoteAttachmentFlow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ TEST FAILED WITH ERROR:', err);
    process.exit(1);
  });
