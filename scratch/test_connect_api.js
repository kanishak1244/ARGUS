import fetch from 'node-fetch';

async function run() {
  console.log('Testing valid active local IP: 127.0.0.1');
  try {
    const res = await fetch('http://localhost:5000/api/connect-rover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: '127.0.0.1' })
    });
    console.log('Active IP response:', res.status, await res.json());
  } catch (e) {
    console.error(e);
  }
}

run();
