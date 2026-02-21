import React, { useState, useEffect } from 'react';
import useAuth from '../hooks/useAuth';
import Home from './Home';
import Groups from './Groups';
import Limits from './Limits';
import GroupEdit from './GroupEdit';
import Spinner from '../components/Spinner';
import LLMPanel from '../components/LLMPanel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../components/ui/resizable';
import { syncLimitsToStorage } from '../utils/syncLimitsToStorage';
import { MessageSquare } from 'lucide-react';

type TabType = 'home' | 'groups' | 'limits';
type ViewType = 'main' | 'groupEdit';

/**
 * Main router component. Child of App.tsx, manages tabs (Home, Groups, Limits) and full-page views (GroupEdit).
 * NOT a page itself - switches between child components based on state.
 * Handles tab navigation and view routing for the entire extension.
 */
const Popup: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [currentView, setCurrentView] = useState<ViewType>('main');
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [isAIPanelCollapsed, setIsAIPanelCollapsed] = useState(false);

  // Sync limits to chrome.storage on app initialization
  useEffect(() => {
    if (user?.uid) {
      syncLimitsToStorage(user.uid).catch(error => {
        console.error('Error syncing limits on initialization:', error);
      });
    }
  }, [user?.uid]);

  if (authLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Main view with tabs
  return (
    <div className="h-screen w-full flex flex-col relative">
      <ResizablePanelGroup direction="vertical">
        {/* Top panel with tabs */}
        <ResizablePanel defaultSize={60} minSize={20}>
          <div className="h-full flex flex-col">
            {/* Conditionally show tabs only in main view */}
            {currentView === 'main' && (
              <div className="flex border-b border-gray-700 bg-gray-900">
                <button
                  onClick={() => setCurrentTab('home')}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    currentTab === 'home'
                      ? 'text-white border-b-2 border-blue-500 bg-gray-800'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  Account
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
            )}

            {/* Content - either tabs or full-page views */}
            <div className="flex-1 overflow-y-auto">
              {currentView === 'main' && (
                <>
                  {currentTab === 'home' && (
                    <Home user={user} />
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
                </>
              )}
              {currentView === 'groupEdit' && editingGroupId && (
                <GroupEdit
                  user={user}
                  groupId={editingGroupId}
                  onBack={() => {
                    setCurrentView('main');
                    setEditingGroupId(null);
                  }}
                />
              )}
            </div>
          </div>
        </ResizablePanel>

        {!isAIPanelCollapsed && <ResizableHandle withHandle />}

        {/* Bottom panel with LLM */}
        {!isAIPanelCollapsed && (
          <ResizablePanel defaultSize={40} minSize={15}>
            <LLMPanel user={user} onCollapse={() => setIsAIPanelCollapsed(true)} />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      {/* Floating chat button when collapsed */}
      {isAIPanelCollapsed && (
        <button
          onClick={() => setIsAIPanelCollapsed(false)}
          className="fixed bottom-4 right-4 w-14 h-14 bg-slate-700 hover:bg-slate-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 z-50"
          title="Open AI Assistant"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}
    </div>
  );
};

export default Popup;
