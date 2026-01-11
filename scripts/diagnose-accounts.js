/**
 * Diagnostic Script: Show all user accounts and their integrations
 * This helps understand the "two accounts" issue
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function diagnoseAccounts() {
  console.log('🔍 DIAGNOSING FIRSTQA ACCOUNTS\n');
  console.log('=' .repeat(80));

  // 1. Show all users in public.users
  console.log('\n📊 ALL USER ACCOUNTS:\n');
  const { data: users, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id, email, created_at, plan, analyses_this_month')
    .order('created_at', { ascending: true });

  if (usersError) {
    console.error('❌ Error fetching users:', usersError);
    return;
  }

  users.forEach((user, index) => {
    console.log(`Account ${index + 1}:`);
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Created: ${new Date(user.created_at).toLocaleString()}`);
    console.log(`  Plan: ${user.plan}`);
    console.log(`  Analyses this month: ${user.analyses_this_month}`);
    console.log('');
  });

  // 2. Show all integrations
  console.log('=' .repeat(80));
  console.log('\n🔗 ALL INTEGRATIONS:\n');
  const { data: integrations, error: integrationsError } = await supabaseAdmin
    .from('integrations')
    .select('id, user_id, provider, account_id, account_name, created_at')
    .order('created_at', { ascending: true });

  if (integrationsError) {
    console.error('❌ Error fetching integrations:', integrationsError);
    return;
  }

  if (integrations.length === 0) {
    console.log('  No integrations found');
  } else {
    integrations.forEach((integration, index) => {
      console.log(`Integration ${index + 1}:`);
      console.log(`  ID: ${integration.id}`);
      console.log(`  User ID: ${integration.user_id}`);
      console.log(`  Provider: ${integration.provider}`);
      console.log(`  Account ID: ${integration.account_id}`);
      console.log(`  Account Name: ${integration.account_name || 'N/A'}`);
      console.log(`  Created: ${new Date(integration.created_at).toLocaleString()}`);
      console.log('');
    });
  }

  // 3. Show all analyses
  console.log('=' .repeat(80));
  console.log('\n📝 ALL ANALYSES:\n');
  const { data: analyses, error: analysesError } = await supabaseAdmin
    .from('analyses')
    .select('id, user_id, provider, repository, pr_number, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (analysesError) {
    console.error('❌ Error fetching analyses:', analysesError);
    return;
  }

  if (analyses.length === 0) {
    console.log('  No analyses found');
  } else {
    analyses.forEach((analysis, index) => {
      console.log(`Analysis ${index + 1}:`);
      console.log(`  ID: ${analysis.id}`);
      console.log(`  User ID: ${analysis.user_id}`);
      console.log(`  Provider: ${analysis.provider}`);
      console.log(`  Repository: ${analysis.repository}`);
      console.log(`  PR #: ${analysis.pr_number}`);
      console.log(`  Created: ${new Date(analysis.created_at).toLocaleString()}`);
      console.log('');
    });
  }

  // 4. Show mapping
  console.log('=' .repeat(80));
  console.log('\n🗺️  ACCOUNT → INTEGRATIONS → ANALYSES MAPPING:\n');
  
  for (const user of users) {
    console.log(`📧 ${user.email} (${user.id})`);
    
    const userIntegrations = integrations.filter(i => i.user_id === user.id);
    if (userIntegrations.length === 0) {
      console.log('   ❌ No integrations');
    } else {
      userIntegrations.forEach(integration => {
        console.log(`   ✅ ${integration.provider}: ${integration.account_name || integration.account_id}`);
      });
    }
    
    const userAnalyses = analyses.filter(a => a.user_id === user.id);
    console.log(`   📊 ${userAnalyses.length} analyses`);
    console.log('');
  }

  console.log('=' .repeat(80));
  console.log('\n✅ DIAGNOSIS COMPLETE\n');
}

diagnoseAccounts().catch(console.error);
