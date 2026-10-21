import type { Kysely } from 'kysely';

// Offer confirmations are stored in the existing negotiationHistory table:
//   offerType 'OFFER'   - a budget/duration proposal by a party
//   offerType 'CONFIRM' - a party confirming the latest proposal
// A confirmation only counts if it was made after the latest offer, so any new offer
// automatically invalidates earlier confirmations.

export async function getLatestOffer(exec: Kysely<any>, chatThreadId: string) {
    return exec
        .selectFrom('negotiationHistory')
        .select(['id', 'senderType', 'amount', 'days', 'createdAt'])
        .where('chatThreadId', '=', chatThreadId)
        .where('offerType', '=', 'OFFER')
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
}

export async function getOfferConfirmationState(exec: Kysely<any>, chatThreadId: string) {
    const latest = await getLatestOffer(exec, chatThreadId);
    if (!latest) {
        return { latest: null, clientConfirmed: false, freelancerConfirmed: false, ready: false };
    }

    const confirmations = await exec
        .selectFrom('negotiationHistory')
        .select(['senderType', 'createdAt'])
        .where('chatThreadId', '=', chatThreadId)
        .where('offerType', '=', 'CONFIRM')
        .where('createdAt', '>', latest.createdAt)
        .execute();

    const clientConfirmed = confirmations.some((c) => c.senderType === 'CLIENT');
    const freelancerConfirmed = confirmations.some((c) => c.senderType === 'FREELANCER');

    // The party that made the latest offer does not confirm it. Agreement needs the other party to accept it.
    const recipientConfirmed = latest.senderType === 'CLIENT' ? freelancerConfirmed : clientConfirmed;

    return {
        latest,
        clientConfirmed,
        freelancerConfirmed,
        ready: recipientConfirmed,
    };
}
