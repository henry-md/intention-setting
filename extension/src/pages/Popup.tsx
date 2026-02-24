import React, { useState, useEffect, useRef } from 'react';
import useAuth from '../hooks/useAuth';
import Home from './Home';
import Rules from './Rules';
import Groups from './Groups';
import GroupEdit from './GroupEdit';
import Settings from './Settings';
import Spinner from '../components/Spinner';
import LLMPanel from '../components/LLMPanel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../components/ui/resizable';
import { syncRulesToStorage } from '../utils/syncRulesToStorage';
import { Bot } from 'lucide-react';
import type { ImperativePanelHandle } from 'react-resizable-panels';

type TabType = 'home' | 'rules' | 'settings';
type RulesView = 'rules' | 'groups' | 'groupEdit';

/**
 * Main router component. Child of App.tsx, manages tabs (Home, Rules).
 * NOT a page itself - switches between child components based on state.
 * Handles tab navigation and view routing for the entire extension.
 */
const Popup: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabType>('rules');
  const [rulesView, setRulesView] = useState<RulesView>('rules');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingFromRules, setEditingFromRules] = useState(false);
  const [editingRuleIdBeforeGroupEdit, setEditingRuleIdBeforeGroupEdit] = useState<string | null>(null);
  const [isAIPanelCollapsed, setIsAIPanelCollapsed] = useState(true);
  const aiPanelRef = useRef<ImperativePanelHandle>(null);

  // Sync rules to chrome.storage on app initialization
  useEffect(() => {
    if (user?.uid) {
      syncRulesToStorage(user.uid).catch(error => {
        console.error('Error syncing rules on initialization:', error);
      });
    }
  }, [user?.uid]);

  // When a usage reset is applied, return UI to default state.
  useEffect(() => {
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (!changes.usageResetAppliedAt) return;

      setCurrentTab('rules');
      setRulesView('rules');
      setEditingGroupId(null);
      setEditingFromRules(false);
      setEditingRuleIdBeforeGroupEdit(null);
      setIsAIPanelCollapsed(true);
      aiPanelRef.current?.collapse();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

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
        <ResizablePanel
          id="main-content"
          order={1}
          defaultSize={100}
          minSize={20}
        >
          <div className="h-full flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-zinc-700 bg-zinc-900">
                <button
                  onClick={() => {
                    setCurrentTab('rules');
                    setRulesView('rules');
                    // Don't clear editingRuleIdBeforeGroupEdit here - it's needed for Rules view
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    currentTab === 'rules'
                      ? 'text-white border-b-2 border-zinc-500 bg-zinc-800'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  Rules
                </button>
                <button
                  onClick={() => {
                    setCurrentTab('home');
                    setEditingRuleIdBeforeGroupEdit(null);
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    currentTab === 'home'
                      ? 'text-white border-b-2 border-zinc-500 bg-zinc-800'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  Account
                </button>
                <button
                  onClick={() => {
                    setCurrentTab('settings');
                    setEditingRuleIdBeforeGroupEdit(null);
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    currentTab === 'settings'
                      ? 'text-white border-b-2 border-zinc-500 bg-zinc-800'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  Settings
                </button>
            </div>

            {/* Content */}
            <div className="extension-gradient-bg flex-1 overflow-y-auto">
              {currentTab === 'home' && (
                <Home user={user} />
              )}
              {currentTab === 'rules' && rulesView === 'rules' && (
                <Rules
                  user={user}
                  onNavigateToGroups={() => {
                    setEditingFromRules(false);
                    setEditingRuleIdBeforeGroupEdit(null);
                    setRulesView('groups');
                  }}
                  onEditGroup={(groupId, currentlyEditingRuleId) => {
                    setEditingGroupId(groupId);
                    setEditingFromRules(true);
                    setEditingRuleIdBeforeGroupEdit(currentlyEditingRuleId || null);
                    setRulesView('groupEdit');
                  }}
                  initialEditingRuleId={editingRuleIdBeforeGroupEdit}
                />
              )}
              {currentTab === 'rules' && rulesView === 'groups' && (
                <Groups
                  user={user}
                  onEditGroup={(groupId) => {
                    setEditingGroupId(groupId);
                    setEditingFromRules(false);
                    setEditingRuleIdBeforeGroupEdit(null);
                    setRulesView('groupEdit');
                  }}
                  onBack={() => {
                    setEditingRuleIdBeforeGroupEdit(null);
                    setRulesView('rules');
                  }}
                />
              )}
              {currentTab === 'rules' && rulesView === 'groupEdit' && editingGroupId && (
                <GroupEdit
                  user={user}
                  groupId={editingGroupId}
                  onBack={() => {
                    setEditingGroupId(null);
                    if (editingFromRules) {
                      setEditingFromRules(false);
                      setRulesView('rules');
                      // Keep editingRuleIdBeforeGroupEdit so Rules can restore the form
                    } else {
                      setEditingRuleIdBeforeGroupEdit(null);
                      setRulesView('groups');
                    }
                  }}
                />
              )}
              {currentTab === 'settings' && (
                <Settings user={user} />
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          disabled={isAIPanelCollapsed}
          className={isAIPanelCollapsed ? 'opacity-0 pointer-events-none' : ''}
        />

        {/* Bottom panel with LLM */}
        <ResizablePanel
          ref={aiPanelRef}
          id="ai-assistant"
          order={2}
          defaultSize={0}
          minSize={0}
          collapsible={true}
          collapsedSize={0}
          onCollapse={() => setIsAIPanelCollapsed(true)}
          onExpand={() => setIsAIPanelCollapsed(false)}
        >
          <LLMPanel
            user={user}
            onCollapse={() => {
              aiPanelRef.current?.collapse();
            }}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Floating chat button when collapsed */}
      {isAIPanelCollapsed && currentTab === 'rules' && (
        <button
          onClick={() => {
            aiPanelRef.current?.resize(40);
            setIsAIPanelCollapsed(false);
          }}
          className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-white shadow-lg transition-all hover:scale-110 hover:bg-zinc-700"
          title="Open AI Assistant"
        >
          <Bot className="w-6 h-6" />
        </button>
      )}
    </div>
  );
};

export default Popup;
