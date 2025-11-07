import { hyphaWebsocketClient } from 'hypha-rpc';
import dotenv from 'dotenv';

dotenv.config();

async function testHyphaConnection() {
  console.log('🔌 Testing Hypha Server Connection...\n');
  
  const config = {
    server_url: process.env.HYPHA_SERVER_URL || 'https://hypha.aicell.io',
    token: process.env.WORKSPACE_TOKEN
  };
  
  try {
    console.log('   Server URL:', config.server_url);
    console.log('   Token:', config.token ? '✓ Present' : '✗ Missing');
    
    const server = await hyphaWebsocketClient.connectToServer(config);
    
    console.log('\n✅ Connection successful!');
    console.log('   Workspace:', server.config.workspace);
    console.log('   User ID:', server.config.user?.id);
    console.log('   Public URL:', server.config.public_base_url);
    
    await server.disconnect();
    return true;
  } catch (error) {
    console.error('\n❌ Connection failed:', error);
    return false;
  }
}

testHyphaConnection()
  .then(success => process.exit(success ? 0 : 1));

