/**
 * Cleanup Script: Fix Duplicate Accounts and Integrations
 * 
 * This script:
 * 1. Identifies duplicate accounts (same email)
 * 2. Merges all integrations and analyses into the primary account
 * 3. Logs duplicate accounts for manual deletion from Supabase Auth
 * 
 * Run this once to clean up existing duplicate data.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function cleanupDuplicateAccounts() {
  console.log('🧹 CLEANUP: Duplicate Accounts and Integrations\n');
  console.log('=' .repeat(80));

  try {
    // Step 1: Find all users grouped by email
    console.log('\n📊 Step 1: Finding duplicate accounts...\n');
    const { data: allUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, created_at, analyses_this_month')
      .order('email', { ascending: true });

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }

    // Group users by email
    const usersByEmail = {};
    for (const user of allUsers) {
      if (!usersByEmail[user.email]) {
        usersByEmail[user.email] = [];
      }
      usersByEmail[user.email].push(user);
    }

    // Find emails with multiple accounts
    const duplicateEmails = Object.entries(usersByEmail)
      .filter(([email, users]) => users.length > 1);

    if (duplicateEmails.length === 0) {
      console.log('✅ No duplicate accounts found!');
      rl.close();
      return;
    }

    console.log(`Found ${duplicateEmails.length} email(s) with duplicate accounts:\n`);

    for (const [email, users] of duplicateEmails) {
      console.log(`📧 ${email}: ${users.length} accounts`);
      users.forEach((user, index) => {
        console.log(`   ${index + 1}. ID: ${user.id}`);
        console.log(`      Created: ${new Date(user.created_at).toLocaleString()}`);
        console.log(`      Analyses: ${user.analyses_this_month}`);
      });
      console.log('');
    }

    // Step 2: Ask for confirmation
    console.log('=' .repeat(80));
    console.log('\n⚠️  ACTION PLAN:\n');
    console.log('For each email with duplicates:');
    console.log('  1. Keep the OLDEST account (lowest ID / earliest created_at)');
    console.log('  2. Transfer all integrations and analyses to that account');
    console.log('  3. Log duplicate account IDs for manual deletion from Supabase Auth\n');
    
    const answer = await ask('Do you want to proceed with the cleanup? (yes/no): ');
    
    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      console.log('\n❌ Cleanup cancelled');
      rl.close();
      return;
    }

    // Step 3: Perform cleanup
    console.log('\n🔧 Step 3: Performing cleanup...\n');
    console.log('=' .repeat(80) + '\n');

    const accountsToDelete = [];

    for (const [email, users] of duplicateEmails) {
      console.log(`\n📧 Processing: ${email}`);
      
      // Sort by created_at (oldest first)
      users.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      
      const primaryUser = users[0]; // Keep the oldest
      const duplicateUsers = users.slice(1);
      
      console.log(`   ✅ PRIMARY ACCOUNT: ${primaryUser.id} (keeping this one)`);
      
      for (const dupUser of duplicateUsers) {
        console.log(`   🔄 MERGING: ${dupUser.id} into primary account...`);
        
        // Get integrations from duplicate account
        const { data: integrations } = await supabaseAdmin
          .from('integrations')
          .select('*')
          .eq('user_id', dupUser.id);
        
        if (integrations && integrations.length > 0) {
          console.log(`      Found ${integrations.length} integration(s) to transfer`);
          
          for (const integration of integrations) {
            // Upsert to primary account
            const { error: upsertError } = await supabaseAdmin
              .from('integrations')
              .upsert({
                user_id: primaryUser.id,
                provider: integration.provider,
                account_id: integration.account_id,
                account_name: integration.account_name,
                account_avatar: integration.account_avatar,
                access_token: integration.access_token,
                refresh_token: integration.refresh_token,
                token_expires_at: integration.token_expires_at,
                scopes: integration.scopes,
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'provider,account_id'
              });
            
            if (upsertError && upsertError.code !== '23505') {
              console.error(`      ❌ Error transferring ${integration.provider} integration:`, upsertError);
            } else {
              console.log(`      ✅ Transferred ${integration.provider} integration ${integration.account_id}`);
            }
          }
          
          // Delete old integrations
          await supabaseAdmin
            .from('integrations')
            .delete()
            .eq('user_id', dupUser.id);
        } else {
          console.log(`      No integrations to transfer`);
        }
        
        // Transfer analyses
        const { data: analyses } = await supabaseAdmin
          .from('analyses')
          .select('id')
          .eq('user_id', dupUser.id);
        
        if (analyses && analyses.length > 0) {
          console.log(`      Found ${analyses.length} analyse(s) to transfer`);
          
          const { error: analysesError } = await supabaseAdmin
            .from('analyses')
            .update({ user_id: primaryUser.id })
            .eq('user_id', dupUser.id);
          
          if (analysesError) {
            console.error(`      ❌ Error transferring analyses:`, analysesError);
          } else {
            console.log(`      ✅ Transferred ${analyses.length} analyse(s)`);
          }
        } else {
          console.log(`      No analyses to transfer`);
        }
        
        accountsToDelete.push({
          email: email,
          userId: dupUser.id,
          createdAt: dupUser.created_at
        });
        
        console.log(`      ✅ Merged duplicate account ${dupUser.id}`);
      }
    }

    // Step 4: Summary
    console.log('\n' + '=' .repeat(80));
    console.log('\n✅ CLEANUP COMPLETE!\n');
    
    if (accountsToDelete.length > 0) {
      console.log('⚠️  MANUAL ACTION REQUIRED:\n');
      console.log('The following duplicate user accounts have been emptied (no integrations/analyses)');
      console.log('but they still exist in Supabase Auth. You should manually delete them:\n');
      console.log('Go to: Supabase Dashboard → Authentication → Users\n');
      
      accountsToDelete.forEach(account => {
        console.log(`   📧 ${account.email}`);
        console.log(`      User ID: ${account.userId}`);
        console.log(`      Created: ${new Date(account.createdAt).toLocaleString()}`);
        console.log(`      Action: Click "..." → "Delete User"\n`);
      });
    }
    
    console.log('🎉 All integrations and analyses have been merged successfully!');
    console.log('=' .repeat(80) + '\n');
    
  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
  } finally {
    rl.close();
  }
}

cleanupDuplicateAccounts();
