import { GET as getHandler } from './_get';

export async function GET(request: Request) {
    return getHandler(request);
}

