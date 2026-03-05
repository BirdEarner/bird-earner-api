import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
    try {
        (await cookies()).delete('token');
        return NextResponse.json({ message: 'Logged out successfully' });
    } catch (error) {
        return NextResponse.json({ message: 'Error logging out' }, { status: 500 });
    }
}
