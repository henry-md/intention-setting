import React, { useState } from 'react';
import useAuth from '../hooks/useAuth';
import Home from './Home';
import Account from './Account';
import Groups from './Groups';
import Limits from './Limits';
import GroupEdit from './GroupEdit';
import Spinner from '../components/Spinner';
import LLMPanel from '../components/LLMPanel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../components/ui/resizable';

type TabType = 'home' | 'groups' | 'limits';
type ViewType = 'main' | 'account' | 'groupEdit';

/**
 * Main router component. Child of App.tsx, manages tabs (Home, Groups, Limits) and full-page views (Account, GroupEdit).
 * NOT a page itself - switches between child components based on state.
 * Handles tab navigation and view routing for the entire extension.
 */
const Popup: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [currentView, setCurrentView] = useState<ViewType>('main');
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Account view
  if (currentView === 'account') {
    return <Account onBack={() => setCurrentView('main')} />;
  }

  // Group edit view
  if (currentView === 'groupEdit' && editingGroupId) {
    return (
      <GroupEdit
        user={user}
        groupId={editingGroupId}
        onBack={() => {
          setCurrentView('main');
          setEditingGroupId(null);
        }}
      />
    );
  }

  // Main view with tabs
  return (
    <div className="h-screen w-full flex flex-col">
      <ResizablePanelGroup direction="vertical">
        {/* Top panel with tabs */}
        <ResizablePanel defaultSize={60} minSize={30}>
          <div className="h-full flex flex-col">
            {/* Tab Navigation */}
            <div className="flex border-b border-gray-700 bg-gray-900">
              <button
                onClick={() => setCurrentTab('home')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  currentTab === 'home'
                    ? 'text-white border-b-2 border-blue-500 bg-gray-800'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                Home
              </button>
              <button
                onClick={() => setCurrentTab('groups')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  currentTab === 'groups'
                    ? 'text-white border-b-2 border-blue-500 bg-gray-800'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                Groups
              </button>
              <button
                onClick={() => setCurrentTab('limits')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  currentTab === 'limits'
                    ? 'text-white border-b-2 border-blue-500 bg-gray-800'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                Limits
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
              {currentTab === 'home' && (
                <Home onShowAccount={() => setCurrentView('account')} user={user} />
              )}
              {currentTab === 'groups' && (
                <Groups
                  user={user}
                  onEditGroup={(groupId) => {
                    setEditingGroupId(groupId);
                    setCurrentView('groupEdit');
                  }}
                />
              )}
              {currentTab === 'limits' && <Limits user={user} />}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Bottom panel with LLM */}
        <ResizablePanel defaultSize={40} minSize={20}>
          <LLMPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default Popup;
