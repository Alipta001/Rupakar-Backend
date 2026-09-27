import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { connectMongo, disconnectMongo } from './app/database/connection.js';
import { User } from './app/models/user.model.js';

async function main() {
  const args = process.argv.slice(2);
  let name = process.env.ADMIN_NAME || args[0];
  let email = (process.env.ADMIN_EMAIL || args[1] || '').toLowerCase().trim();
  let password = process.env.ADMIN_PASSWORD || args[2] || '';

  if (!email || !password) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input, output });
      try {
        if (!name) {
          name = (await rl.question('Enter Admin Name [Rupakar Admin]: ')).trim() || 'Rupakar Admin';
        }
        if (!email) {
          email = (await rl.question('Enter Admin Email: ')).toLowerCase().trim();
        }
        if (!password) {
          password = (await rl.question('Enter Admin Password: ')).trim();
        }
      } finally {
        rl.close();
      }
    } else {
      console.error('Usage: node create-admin.js <name> <email> <password>');
      console.error('   Or: ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." node create-admin.js');
      process.exit(1);
    }
  }

  if (!email) {
    console.error('Error: Email is required.');
    process.exit(1);
  }

  if (!password || password.length < 8) {
    console.error('Error: Password must be at least 8 characters long.');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await connectMongo();


    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.role === 'admin') {
        console.log(`Notice: Admin user already exists with email: ${email}`);
        // Optionally update password if requested
        const updatePassword = process.env.ADMIN_UPDATE_PASSWORD === 'true';
        if (updatePassword) {
          existingUser.password = await bcrypt.hash(password, 12);
          existingUser.name = name;
          existingUser.isEmailVerified = true;
          existingUser.verificationStatus = 'VERIFIED';
          existingUser.isActive = true;
          await existingUser.save();
          console.log(`Successfully updated existing admin password for ${email}.`);
        }
      } else {
        console.log(`Upgrading existing user (${email}) to 'admin' role...`);
        existingUser.role = 'admin';
        existingUser.isEmailVerified = true;
        existingUser.verificationStatus = 'VERIFIED';
        existingUser.isActive = true;
        existingUser.password = await bcrypt.hash(password, 12);
        await existingUser.save();
        console.log(`User ${email} successfully promoted to administrator.`);
      }
    } else {
      console.log(`Creating new administrator account for ${email}...`);
      const hashedPassword = await bcrypt.hash(password, 12);
      await User.create({
        name,
        email,
        password: hashedPassword,
        role: 'admin',
        isEmailVerified: true,
        verificationStatus: 'VERIFIED',
        isActive: true,
        pendingExpiresAt: null,
      });
      console.log(`Administrator account created successfully for ${email}.`);
    }
  } catch (err) {
    console.error('Failed to create admin user:', err.message);
    process.exit(1);
  } finally {
    await disconnectMongo();
  }
}

main();
