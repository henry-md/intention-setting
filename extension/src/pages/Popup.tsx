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
import { MessageSquare } from 'lucide-react';
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
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const [rulesView, setRulesView] = useState<RulesView>('rules');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingFromRules, setEditingFromRules] = useState(false);
  const [editingRuleIdBeforeGroupEdit, setEditingRuleIdBeforeGroupEdit] = useState<string | null>(null);
  const [isAIPanelCollapsed, setIsAIPanelCollapsed] = useState(false);
  const aiPanelRef = useRef<ImperativePanelHandle>(null);

  // Sync rules to chrome.storage on app initialization
  useEffect(() => {
    if (user?.uid) {
      syncRulesToStorage(user.uid).catch(error => {
        console.error('Error syncing rules on initialization:', error);
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
        <ResizablePanel
          id="main-content"
          order={1}
          defaultSize={60}
          minSize={20}
        >
          <div className="h-full flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-gray-700 bg-gray-900">
                <button
                  onClick={() => {
                    setCurrentTab('home');
                    setEditingRuleIdBeforeGroupEdit(null);
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    currentTab === 'home'
                      ? 'text-white border-b-2 border-blue-500 bg-gray-800'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  Account
                </button>
                <button
                  onClick={() => {
                    setCurrentTab('rules');
                    setRulesView('rules');
                    // Don't clear editingRuleIdBeforeGroupEdit here - it's needed for Rules view
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    currentTab === 'rules'
                      ? 'text-white border-b-2 border-blue-500 bg-gray-800'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  Rules
                </button>
                <button
                  onClick={() => {
                    setCurrentTab('settings');
                    setEditingRuleIdBeforeGroupEdit(null);
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    currentTab === 'settings'
                      ? 'text-white border-b-2 border-blue-500 bg-gray-800'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  Settings
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
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

        {!isAIPanelCollapsed && <ResizableHandle withHandle />}

        {/* Bottom panel with LLM */}
        <ResizablePanel
          ref={aiPanelRef}
          id="ai-assistant"
          order={2}
          defaultSize={40}
          minSize={15}
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
            aiPanelRef.current?.expand();
          }}
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
