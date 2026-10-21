import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { sendMessage, createOrGetThread, respondToWorkSubmissionMessage } from '../lib/services/chats';

/**
 * Work submission versioning test (remote job).
 * Covers: files added to an unreviewed version join it, superseded controls are rejected,
 * a revision opens the next version, concurrent sends do not create duplicate versions,
 * and history is kept.
 * Stops before Accept, because Accept releases payment.
 * Writes real rows to the database in DATABASE_URL and reserves funds for the test job.
 */

type Card = {
  id: string;
  version: number;
  revision?: number;
  submissionStatus: string;
  isLatestForVersion?: boolean;
  reviewControlActive?: boolean;
  files: string[];
};

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`   PASS: ${message}`);
};

const parseJson = (value: unknown): any => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  return value;
};

const fileUrl = (name: string) => `https://res.cloudinary.com/demo/image/upload/v1/${name}`;

async function main() {
  console.log('=========================================================');
  console.log('TEST: REMOTE WORK SUBMISSION VERSIONS');
  console.log('=========================================================');

  const client = await db
    .selectFrom('clients')
    .innerJoin('users', 'users.id', 'clients.userId')
    .select(['clients.id as clientId', 'users.id as clientUserId'])
    .executeTakeFirst();
  const freelancer = await db
    .selectFrom('freelancers')
    .innerJoin('users', 'users.id', 'freelancers.userId')
    .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId'])
    .executeTakeFirst();
  if (!client || !freelancer) throw new Error('Client or freelancer missing in database');

  const job = await createJob(
    {
      jobTitle: `[SCRIPT TEST] Work submission versions ${new Date().toISOString()}`,
      jobDescription: 'Automated test of work submission versioning. Not a real job.',
      jobCategory: 'Design & Creative',
      jobSubCategory: 'Logo Design',
      projectType: 'Remote',
      budgetType: 'Fixed',
      budgetAmount: 100,
      workDurationDays: 2,
      paymentMethod: 'PLATFORM',
      location: 'Remote Work',
    },
    client.clientUserId,
    client.clientId
  );
  await assignFreelancer(job.id, freelancer.freelancerId, client.clientUserId);
  const thread = await createOrGetThread(job.id, freelancer.freelancerId, client.clientId);
  console.log(`Job ${job.id} | Thread ${thread.id}`);

  // Sends one attachment message (unit 1) and its submission card (unit 2), the same way the app does
  const submit = async (names: string[]): Promise<string> => {
    const attachments = names.map((name) => ({
      attachmentUrl: fileUrl(name),
      attachmentName: name,
      attachmentSize: 1000,
      attachmentMime: 'image/png',
    }));
    await sendMessage({
      chatThreadId: thread.id,
      senderId: freelancer.freelancerUserId,
      receiverId: client.clientUserId,
      messageContent: '',
      messageType: 'ATTACHMENT',
      senderType: 'FREELANCER',
      attachments,
    });
    const card = await sendMessage({
      chatThreadId: thread.id,
      senderId: freelancer.freelancerUserId,
      receiverId: client.clientUserId,
      messageContent: '',
      messageType: 'WORK_SUBMISSION',
      senderType: 'FREELANCER',
      messageData: {
        isWorkSubmission: true,
        submissionStatus: 'PENDING',
        submissionAttachments: attachments,
      },
    });
    return card.id;
  };

  const getCards = async (): Promise<Card[]> => {
    const rows = await db
      .selectFrom('messages')
      .select(['id', 'messageData', 'createdAt'])
      .where('chatThreadId', '=', thread.id)
      .orderBy('createdAt', 'asc')
      .execute();
    return rows
      .map((row) => ({ row, data: parseJson(row.messageData) }))
      .filter(({ data }) => data?.isWorkSubmission)
      .map(({ row, data }) => ({
        id: row.id,
        version: data.version,
        revision: data.submissionRevision,
        submissionStatus: data.submissionStatus,
        isLatestForVersion: data.isLatestForVersion,
        reviewControlActive: data.reviewControlActive,
        files: (data.submissionAttachments || []).map((f: any) => f.attachmentUrl),
      }));
  };

  const getCard = async (id: string): Promise<Card> => {
    const cards = await getCards();
    const card = cards.find((c) => c.id === id);
    if (!card) throw new Error(`Card ${id} not found`);
    return card;
  };

  const getJob = async () => {
    const row = await db
      .selectFrom('jobs')
      .select(['jobStatus', 'revisionCount', 'submittedWorkData'])
      .where('id', '=', job.id)
      .executeTakeFirstOrThrow();
    const swd = parseJson(row.submittedWorkData) || {};
    return {
      jobStatus: row.jobStatus as string,
      revisionCount: row.revisionCount || 0,
      version: swd.version as number | undefined,
      revision: swd.revision as number | undefined,
      files: ((swd.files || []) as any[]).map((f) => f.fileUrl),
    };
  };

  const expectRejected = async (promise: Promise<unknown>, pattern: RegExp, label: string) => {
    try {
      await promise;
    } catch (error: any) {
      assert(pattern.test(error.message || ''), `${label} (rejected: "${error.message}")`);
      return;
    }
    throw new Error(`ASSERTION FAILED: ${label} was accepted but should be rejected`);
  };

  console.log('\n1. First batch (A, B) creates Version 1');
  const cardAB = await submit(['A.png', 'B.png']);
  let job1 = await getJob();
  assert(job1.jobStatus === 'WORK_SUBMITTED' && job1.version === 1, 'job is WORK_SUBMITTED at version 1');
  assert(job1.files.length === 2, 'version 1 holds 2 files');

  console.log('\n2. Second batch (C, D) before review joins Version 1');
  const cardCD = await submit(['C.png', 'D.png']);
  const job2 = await getJob();
  assert(job2.version === 1, 'version number unchanged (still 1)');
  assert(job2.files.length === 4, 'version 1 now holds all 4 files');
  const cardsAfterAppend = await getCards();
  const oldAB = cardsAfterAppend.find((c) => c.id === cardAB)!;
  const newCD = cardsAfterAppend.find((c) => c.id === cardCD)!;
  assert(oldAB.isLatestForVersion === false && oldAB.reviewControlActive === false, 'previous control is superseded (hidden)');
  assert(newCD.isLatestForVersion === true && newCD.reviewControlActive === true, 'latest control is active');
  assert(newCD.files.length === 4, 'latest control lists all 4 files of the version');

  console.log('\n3. Superseded control cannot be actioned');
  await expectRejected(
    respondToWorkSubmissionMessage(cardAB, client.clientUserId, 'REVISE_REQUESTED', 'stale'),
    /updated with newer files/,
    'respond on superseded control is rejected'
  );

  console.log('\n4. Latest control: Request Revision opens the next version');
  await respondToWorkSubmissionMessage(cardCD, client.clientUserId, 'REVISE_REQUESTED', 'Change colours');
  const job3 = await getJob();
  assert(job3.jobStatus === 'REVISION_REQUESTED', 'job is REVISION_REQUESTED');
  assert(job3.revisionCount === 1, 'revision count is 1');
  const reviewed = await getCard(cardCD);
  assert(reviewed.submissionStatus === 'REVISE_REQUESTED', 'latest control is recorded as REVISE_REQUESTED');

  console.log('\n5. New files after revision create Version 2');
  const cardE = await submit(['E.png']);
  const job4 = await getJob();
  assert(job4.jobStatus === 'WORK_SUBMITTED' && job4.version === 2, 'job is WORK_SUBMITTED at version 2');
  assert(job4.files.length === 1, 'version 2 holds only the new file');
  const cardsV1 = (await getCards()).filter((c) => c.version === 1);
  assert(cardsV1.some((c) => c.id === cardCD && c.submissionStatus === 'REVISE_REQUESTED'), 'version 1 history is kept');
  const cardEState = await getCard(cardE);
  assert(cardEState.version === 2 && cardEState.isLatestForVersion === true, 'version 2 control is the latest');

  console.log('\n6. Concurrent batches (F, G) join Version 2 without duplicates');
  await Promise.all([submit(['F.png']), submit(['G.png'])]);
  const job5 = await getJob();
  assert(job5.version === 2, 'still version 2 after concurrent sends');
  assert(job5.files.length === 3, 'version 2 holds E, F and G (no file lost)');
  const v2Cards = (await getCards()).filter((c) => c.version === 2);
  assert(v2Cards.filter((c) => c.isLatestForVersion === true).length === 1, 'exactly one latest control for version 2');
  assert(v2Cards.filter((c) => c.reviewControlActive === true).length === 1, 'exactly one active control for version 2');

  console.log('\n7. Stale control from before the concurrent batches is rejected');
  await expectRejected(
    respondToWorkSubmissionMessage(cardE, client.clientUserId, 'REVISE_REQUESTED', 'stale'),
    /updated with newer files/,
    'respond on control superseded by concurrent batches is rejected'
  );

  console.log('\n8. Latest control: Request Revision works again');
  const latestV2 = (await getCards()).filter((c) => c.version === 2 && c.isLatestForVersion === true)[0];
  await respondToWorkSubmissionMessage(latestV2.id, client.clientUserId, 'REVISE_REQUESTED', 'Second round');
  const job6 = await getJob();
  assert(job6.jobStatus === 'REVISION_REQUESTED' && job6.revisionCount === 2, 'job is REVISION_REQUESTED with revision count 2');

  console.log(`\nALL CHECKS PASSED. Test job ${job.id} was left in the database (title starts with [SCRIPT TEST]).`);
}

main().catch((error) => {
  console.error('\nTEST FAILED:', error.message);
  process.exitCode = 1;
});
