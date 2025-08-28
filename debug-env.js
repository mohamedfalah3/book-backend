/**
 * Debug script to check environment variables on the server
 */

require('dotenv').config();

console.log('=== Environment Variables Debug ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('R2_ACCESS_KEY:', process.env.R2_ACCESS_KEY ? 'SET' : 'NOT SET');
console.log('R2_SECRET_KEY:', process.env.R2_SECRET_KEY ? 'SET' : 'NOT SET');
console.log('R2_ACCOUNT_ID:', process.env.R2_ACCOUNT_ID ? 'SET' : 'NOT SET');
console.log('R2_BUCKET:', process.env.R2_BUCKET ? 'SET' : 'NOT SET');

console.log('\n=== Raw Values (first 10 chars) ===');
console.log('R2_ACCESS_KEY:', process.env.R2_ACCESS_KEY ? process.env.R2_ACCESS_KEY.substring(0, 10) + '...' : 'undefined');
console.log('R2_SECRET_KEY:', process.env.R2_SECRET_KEY ? process.env.R2_SECRET_KEY.substring(0, 10) + '...' : 'undefined');
console.log('R2_ACCOUNT_ID:', process.env.R2_ACCOUNT_ID ? process.env.R2_ACCOUNT_ID.substring(0, 10) + '...' : 'undefined');
console.log('R2_BUCKET:', process.env.R2_BUCKET || 'undefined');

console.log('\n=== All Environment Variables ===');
Object.keys(process.env)
  .filter(key => key.startsWith('R2_'))
  .forEach(key => {
    console.log(`${key}: ${process.env[key] ? 'SET' : 'NOT SET'}`);
  });
