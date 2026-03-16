'use client';

type IntegrationItem = {
  key: string;
  title: string;
  status: 'connected' | 'disconnected' | 'not_implemented';
  description: string;
};

const INTEGRATIONS: IntegrationItem[] = [
  {
    key: 'email',
    title: 'Email',
    status: 'connected',
    description: 'Mock send is enabled. Ready for the manual flow.',
  },
  {
    key: 'telegram',
    title: 'Telegram',
    status: 'not_implemented',
    description: 'Integration is not implemented in MVP yet.',
  },
  {
    key: 'whatsapp',
    title: 'WhatsApp',
    status: 'not_implemented',
    description: 'Integration is not implemented in MVP yet.',
  },
  {
    key: 'instagram',
    title: 'Instagram',
    status: 'not_implemented',
    description: 'API automation is limited and not implemented yet.',
  },
  {
    key: 'facebook',
    title: 'Facebook',
    status: 'not_implemented',
    description: 'API automation is limited and not implemented yet.',
  },
];

export default function IntegrationsPage() {
  return (
    <div className="crz-page">
      <div className="crz-page-head">
        <div>
          <h1 className="crz-page-title">Integrations</h1>
          <p className="crz-page-subtitle">Channel integrations and their current status</p>
        </div>
      </div>

      <section className="crz-card-grid">
        {INTEGRATIONS.map((integration) => (
          <article className="crz-section" key={integration.key}>
            <div className="crz-row-compact">
              <h2 className="crz-section-title">{integration.title}</h2>
              <span className={`crz-pill crz-pill-${integration.status}`}>
                {integration.status.replace('_', ' ')}
              </span>
            </div>

            <p className="crz-row-meta">{integration.description}</p>

            <div className="crz-inline-row">
              <button className="crz-btn" type="button" disabled={integration.status !== 'connected'}>
                Test channel
              </button>
              <button className="crz-btn" type="button" disabled={integration.status === 'not_implemented'}>
                {integration.status === 'connected' ? 'Reconnect' : 'Connect'}
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
