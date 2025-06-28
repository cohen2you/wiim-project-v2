export async function GET() {
    console.log('🔥 Test API GET called');
    return new Response(JSON.stringify({ message: 'Test API route reachable' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  