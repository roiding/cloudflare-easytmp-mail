import React, { useEffect, useState } from 'react';
import {
  DEFAULT_MAIL_DOMAIN,
  DEFAULT_WEB_AND_API_DOMAIN,
  ServiceConfigResponse,
} from '@easytmp/shared';
import { apiClient } from './api/client';
import { useMailbox } from './hooks/useMailbox';
import { Header } from './components/Header';
import { AddressBar } from './components/AddressBar';
import { MessageList } from './components/MessageList';
import { MessageDetail } from './components/MessageDetail';
import { Footer } from './components/Footer';
import './App.css';

export const App: React.FC = () => {
  const [serviceConfig, setServiceConfig] = useState<ServiceConfigResponse>({
    mailDomain: DEFAULT_MAIL_DOMAIN,
    webHostname: DEFAULT_WEB_AND_API_DOMAIN,
    retentionSeconds: 604_800,
    addressPolicy: {
      minLength: 1,
      maxLength: 64,
      allowedCharacters: 'letters, digits, dot, underscore, hyphen',
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    void apiClient.getConfig(controller.signal).then(
      (config) => setServiceConfig(config),
      () => {
        // A static preview can retain the embedded fallback.
      },
    );
    return () => controller.abort();
  }, []);

  const {
    name,
    address,
    taskSince,
    messages,
    selectedMessageId,
    isLoading,
    isPolling,
    isDocumentHidden,
    error,
    hasMore,
    showAllMessages,
    switchMailbox,
    generateRandomMailbox,
    manualRefresh,
    clearCurrentMailbox,
    deleteSingleMessage,
    loadMoreMessages,
    setSelectedMessageId,
    clearError,
    resetTaskSince,
    toggleShowAllMessages,
  } = useMailbox(serviceConfig.mailDomain);

  return (
    <div className="app-shell">
      <Header />

      <div className="main-content-layout">
        <AddressBar
          name={name}
          address={address}
          mailDomain={serviceConfig.mailDomain}
          messagesCount={messages.length}
          isLoading={isLoading}
          onRefresh={manualRefresh}
          onRandom={generateRandomMailbox}
          onClear={clearCurrentMailbox}
          onSwitch={switchMailbox}
        />

        <MessageList
          mailboxName={name}
          messages={messages}
          taskSince={taskSince}
          isLoading={isLoading}
          isPolling={isPolling}
          isDocumentHidden={isDocumentHidden}
          error={error}
          hasMore={hasMore}
          showAllMessages={showAllMessages}
          onSelectMessage={setSelectedMessageId}
          onLoadMore={loadMoreMessages}
          onClearError={clearError}
          onResetTaskSince={resetTaskSince}
          onToggleShowAll={toggleShowAllMessages}
        />
      </div>

      {selectedMessageId && (
        <MessageDetail
          id={selectedMessageId}
          onClose={() => setSelectedMessageId(null)}
          onDelete={deleteSingleMessage}
        />
      )}

      <Footer mailDomain={serviceConfig.mailDomain} webHostname={serviceConfig.webHostname} />
    </div>
  );
};

export default App;
