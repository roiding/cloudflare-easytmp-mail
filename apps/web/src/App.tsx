import React from 'react';
import { useMailbox } from './hooks/useMailbox';
import { Header } from './components/Header';
import { AddressBar } from './components/AddressBar';
import { MessageList } from './components/MessageList';
import { MessageDetail } from './components/MessageDetail';
import { Footer } from './components/Footer';
import './App.css';

export const App: React.FC = () => {
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
  } = useMailbox();

  return (
    <div className="app-shell">
      <Header />

      <div className="main-content-layout">
        <AddressBar
          name={name}
          address={address}
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

      <Footer />
    </div>
  );
};

export default App;
