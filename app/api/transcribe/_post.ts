import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = (formData.get('audio') || formData.get('file')) as File | null;

        if (!file) {
            return NextResponse.json({ success: false, error: 'No audio file provided' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        let transcript = '';

        // Provider 1: Hugging Face Whisper Large V3 Turbo API (Free & Fast)
        try {
            const mimeType = file.type || 'audio/m4a';
            const hfRes = await fetch(
                'https://api-inference.huggingface.co/models/openai/whisper-large-v3-turbo',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': mimeType,
                    },
                    body: buffer,
                }
            );

            if (hfRes.ok) {
                const hfData = await hfRes.json();
                if (hfData && typeof hfData.text === 'string' && hfData.text.trim()) {
                    transcript = hfData.text.trim();
                }
            }
        } catch (hfErr) {
            console.warn('[Transcribe API] HuggingFace Whisper failed, trying fallback:', hfErr);
        }

        // Provider 2: OpenRouter AI Audio Model (if HF failed and OpenRouter API key is set)
        if (!transcript && process.env.OPENROUTER_API_KEY) {
            try {
                const base64Audio = buffer.toString('base64');
                const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'google/gemini-2.5-flash',
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    {
                                        type: 'text',
                                        text: 'Transcribe this audio recording into accurate English text. Return ONLY the transcribed text, with no extra commentary or quotes.'
                                    },
                                    {
                                        type: 'inline_data',
                                        inline_data: {
                                            mime_type: file.type || 'audio/mp4',
                                            data: base64Audio
                                        }
                                    }
                                ]
                            }
                        ]
                    })
                });

                if (openRouterRes.ok) {
                    const orData = await openRouterRes.json();
                    const aiMessage = orData?.choices?.[0]?.message?.content;
                    if (typeof aiMessage === 'string' && aiMessage.trim()) {
                        transcript = aiMessage.trim().replace(/^["']|["']$/g, '');
                    }
                }
            } catch (orErr) {
                console.warn('[Transcribe API] OpenRouter Whisper failed:', orErr);
            }
        }

        if (!transcript) {
            return NextResponse.json({
                success: false,
                error: 'Could not transcribe audio. Please speak clearly and try again.'
            }, { status: 422 });
        }

        return NextResponse.json({
            success: true,
            text: transcript,
        });
    } catch (error: any) {
        console.error('[Transcribe API Error]:', error);
        return NextResponse.json({
            success: false,
            error: error?.message || 'Failed to process audio transcription'
        }, { status: 500 });
    }
}
