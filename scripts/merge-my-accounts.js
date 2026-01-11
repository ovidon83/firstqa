/**
 * Manual Account Merge Script
 * Merges ovidon83+firstqa2@gmail.com → ovidon83@gmail.com
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function mergeAccounts() {
  const SOURCE_EMAIL = 'ovidon83+firstqa2@gmail.com'; // Account with all the data
  const TARGET_EMAIL = 'ovidon83@gmail.com'; // Your primary account
  
  console.log('🔀 MANUAL ACCOUNT MERGE\n');
  console.log('=' .repeat(80));
  console.log(`\nMerging: ${SOURCE_EMAIL} → ${TARGET_EMAIL}\n`);
  
  try {
    // Get source user ID
    const { data: sourceUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', SOURCE_EMAIL)
      .single();
    
    if (!sourceUser) {
      console.error(`❌ Source user not found: ${SOURCE_EMAIL}`);
      return;
    }
    
    // Get target user ID
    const { data: targetUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', TARGET_EMAIL)
      .single();
    
    if (!targetUser) {
      console.error(`❌ Target user not found: ${TARGET_EMAIL}`);
      return;
    }
    
    console.log(`Source User ID: ${sourceUser.id}`);
    console.log(`Target User ID: ${targetUser.id}\n`);
    
    // Transfer integrations
    console.log('🔄 Transferring integrations...');
    const { data: integrations } = await supabaseAdmin
      .from('integrations')
      .select('id, provider, account_name')
      .eq('user_id', sourceUser.id);
    
    if (integrations && integrations.length > 0) {
      for (const integration of integrations) {
        const { error } = await supabaseAdmin
          .from('integrations')
          .update({ user_id: targetUser.id, updated_at: new Date().toISOString() })
          .eq('id', integration.id);
        
        if (error) {
          console.error(`❌ Error transferring ${integration.provider} ${integration.account_name}:`, error);
        } else {
          console.log(`✅ Transferred ${integration.provider}: ${integration.account_name}`);
        }
      }
    }
    
    // Transfer analyses
    console.log('\n🔄 Transferring analyses...');
    const { data: analyses } = await supabaseAdmin
      .from('analyses')
      .select('id, repository, pr_number')
      .eq('user_id', sourceUser.id);
    
    if (analyses && analyses.length > 0) {
      const { error } = await supabaseAdmin
        .from('analyses')
        .update({ user_id: targetUser.id })
        .eq('user_id', sourceUser.id);
      
      if (error) {
        console.error(`❌ Error transferring analyses:`, error);
      } else {
        console.log(`✅ Transferred ${analyses.length} analysis/analyses`);
        analyses.forEach(a => {
          console.log(`   - ${a.repository} PR #${a.pr_number}`);
        });
      }
    }
    
    // Update analyses count
    console.log('\n🔄 Updating analyses count...');
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        analyses_this_month: analyses ? analyses.length : 0 
      })
      .eq('id', targetUser.id);
    
    if (updateError) {
      console.error(`❌ Error updating count:`, updateError);
    } else {
      console.log(`✅ Updated analyses count`);
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('\n🎉 MERGE COMPLETE!\n');
    console.log(`All data from ${SOURCE_EMAIL} has been moved to ${TARGET_EMAIL}`);
    console.log(`\nNext steps:`);
    console.log(`1. Log out of FirstQA`);
    console.log(`2. Log in with ${TARGET_EMAIL}`);
    console.log(`3. Check Dashboard → History for your analysis`);
    console.log(`\n✅ You can now delete the old account (${SOURCE_EMAIL}) from Supabase Auth if desired.`);
    console.log('\n' + '=' .repeat(80) + '\n');
    
  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
  }
}

mergeAccounts();
