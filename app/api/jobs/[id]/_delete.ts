import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const jobExists = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .select(['clients.userId', 'jobs.cashbackOfferId', 'jobs.jobStatus'])
            .where('jobs.id', '=', id)
            .executeTakeFirst();

        if (!jobExists || jobExists.userId !== user.id) {
            return NextResponse.json({ message: 'Unauthorized or not found' }, { status: 401 });
        }

        if (jobExists.jobStatus !== 'OPEN') {
            return NextResponse.json({ message: 'Only open jobs can be deleted' }, { status: 400 });
        }

        await db.transaction().execute(async (trx) => {
            if (jobExists.cashbackOfferId) {
                await trx
                    .updateTable('cashbackOffers')
                    .set({ reservedJobId: null, updatedAt: new Date() })
                    .where('id', '=', jobExists.cashbackOfferId)
                    .execute();
            }

            await trx
                .deleteFrom('jobs')
                .where('id', '=', id)
                .execute();
        });

        return NextResponse.json({
            success: true,
            message: 'Job deleted successfully'
        });
    } catch (error: any) {
        console.error('Delete job error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to delete job'
        }, { status: 500 });
    }
}
