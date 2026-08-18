'use strict';

const { app } = require('@azure/functions');
const { postToDiscord } = require('../discord');

/**
 * HTTP-triggered function that receives Application Insights alert webhooks
 * and forwards them to Discord.
 *
 * Application Insights sends a JSON payload with alert details including
 * alert name, severity, and query results. This function formats the alert
 * and posts it to the Discord webhook.
 */
async function appInsightsAlert(request, context) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    context.error('DISCORD_WEBHOOK_URL is not configured');
    return {
      status: 400,
      jsonBody: { ok: false, error: 'DISCORD_WEBHOOK_URL is not configured' },
    };
  }

  try {
    const payload = await request.json();
    const schemaId = payload.schemaId || '';

    let alertName, severity, description, fireTime, targetResources, monitorCondition;

    // Handle Common Alert Schema (API 2021-08-01+) - preferred format
    if (schemaId === 'azureMonitorCommonAlertSchema') {
      const essentials = payload.data?.essentials || {};
      alertName = essentials.alertRule || 'Alert';
      severity = essentials.severity || 'Unknown';
      description = payload.data?.essentials?.description || 'No description';
      fireTime = essentials.firedDateTime || new Date().toISOString();
      monitorCondition = essentials.monitorCondition || 'Unknown';
      targetResources = essentials.alertTargetIDs?.[0] || 'Unknown resource';
    } else if (schemaId === 'Microsoft.Insights/LogAlert') {
      // Handle Legacy Application Insights format (API 2018-04-16 and earlier)
      alertName = payload.data?.AlertRuleName || 'Alert';
      severity = `Sev${payload.data?.Severity || '3'}`;
      description = payload.data?.Description || payload.data?.SearchQuery || 'No description';
      fireTime = payload.data?.SearchIntervalEndtimeUtc || new Date().toISOString();
      monitorCondition = `Result Count: ${payload.data?.ResultCount || 0}`;
      targetResources = payload.data?.LinkToSearchResults || 'No link available';
    } else {
      // Fallback for unknown format
      alertName = 'Application Insights Alert';
      severity = 'Unknown';
      description = 'Alert format not recognized';
      fireTime = new Date().toISOString();
      monitorCondition = 'Unknown condition';
      targetResources = 'Unknown resource';
    }

    const severityEmoji = {
      Sev0: '🔴',
      Sev1: '🔴',
      Sev2: '🟠',
      Sev3: '🟡',
      Sev4: '🔵',
    }[severity] || '⚠️';

    const embed = {
      title: `${severityEmoji} ${alertName}`,
      description: description.length > 300 ? description.substring(0, 297) + '...' : description,
      color: {
        Sev0: 0xff0000,
        Sev1: 0xff0000,
        Sev2: 0xffa500,
        Sev3: 0xffff00,
        Sev4: 0x0000ff,
      }[severity] || 0x888888,
      fields: [
        {
          name: 'Severity',
          value: severity,
          inline: true,
        },
        {
          name: 'Status',
          value: monitorCondition,
          inline: true,
        },
        {
          name: 'Time',
          value: new Date(fireTime).toLocaleString(),
          inline: false,
        },
        {
          name: 'Resource',
          value: targetResources.length > 100 ? targetResources.substring(0, 97) + '...' : targetResources,
          inline: false,
        },
      ],
      timestamp: fireTime,
    };

    await postToDiscord(webhookUrl, {
      username: 'Application Insights',
      embeds: [embed],
    });

    context.log(`Posted Application Insights alert to Discord: ${alertName}`);
    return {
      status: 200,
      jsonBody: { ok: true, alert: alertName },
    };
  } catch (error) {
    context.error('Failed to post Application Insights alert to Discord:', error.message);
    return {
      status: 500,
      jsonBody: { ok: false, error: error.message },
    };
  }
}

app.http('appInsightsAlert', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'appinsights/alert',
  handler: appInsightsAlert,
});

module.exports = { appInsightsAlert };
