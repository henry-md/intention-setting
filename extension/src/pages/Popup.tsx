import React, { useState, useEffect, useRef } from 'react';
import useAuth from '../hooks/useAuth';
import Home from './Home';
import Rules from './Rules';
import Groups from './Groups';
import GroupEdit from './GroupEdit';
import Settings from './Settings';
import ManageSubscription from './ManageSubscription';
import Spinner from '../components/Spinner';
import LLMPanel from '../components/LLMPanel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../components/ui/resizable';
import { syncRulesToStorage } from '../utils/syncRulesToStorage';
import { Bot } from 'lucide-react';
import type { ImperativePanelHandle } from 'react-resizable-panels';

type TabType = 'home' | 'rules' | 'settings';
type RulesView = 'rules' | 'groups' | 'groupEdit';
const HARD_REQUIREMENT_GOOGLE_SIGN_IN = import.meta.env.HARD_REQUIREMENT_GOOGLE_SIGN_IN === 'true';

const GoogleIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    className="h-5 w-5 shrink-0"
    viewBox="0 0 24 24"
  >
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
    />
  </svg>
);

interface SignInRequiredScreenProps {
  onSignIn: () => void;
}

const SignInRequiredScreen: React.FC<SignInRequiredScreenProps> = ({ onSignIn }) => (
  <div className="h-screen w-full extension-gradient-bg flex items-center justify-center p-6">
    <div className="w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900/95 p-5 shadow-2xl">
      <div className="mb-5 text-center">
        <h1 className="text-xl font-semibold text-zinc-50">Intention Setting</h1>
        <p className="mt-1 text-sm text-zinc-400">Sign in to continue</p>
      </div>

      <button
        type="button"
        onClick={onSignIn}
        className="flex h-11 w-full items-center justify-center gap-3 rounded border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-100 active:bg-zinc-200"
      >
        <GoogleIcon />
        <span>Sign in with Google</span>
      </button>
    </div>
  </div>
);

/**
 * Main router component. Child of App.tsx, manages tabs (Home, Rules).
 * NOT a page itself - switches between child components based on state.
 * Handles tab navigation and view routing for the entire extension.
 */
const Popup: React.FC = () => {
  const { user, loading: authLoading, handleSignIn } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabType>('rules');
  const [rulesView, setRulesView] = useState<RulesView>('rules');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingFromRules, setEditingFromRules] = useState(false);
  const [editingRuleIdBeforeGroupEdit, setEditingRuleIdBeforeGroupEdit] = useState<string | null>(null);
  const [isAIPanelCollapsed, setIsAIPanelCollapsed] = useState(true);
  const [isManageSubscriptionOpen, setIsManageSubscriptionOpen] = useState(false);
  const aiPanelRef = useRef<ImperativePanelHandle>(null);
  const lastUserIdRef = useRef<string | null>(null);

  // Reset to the primary app surface when a user signs in or switches accounts.
  useEffect(() => {
    if (authLoading) return;

    const nextUserId = user?.uid || null;
    if (nextUserId && nextUserId !== lastUserIdRef.current) {
      setCurrentTab('rules');
      setRulesView('rules');
      setEditingGroupId(null);
      setEditingFromRules(false);
      setEditingRuleIdBeforeGroupEdit(null);
      setIsManageSubscriptionOpen(false);
      setIsAIPanelCollapsed(true);
      aiPanelRef.current?.collapse();
    }

    if (!nextUserId && !HARD_REQUIREMENT_GOOGLE_SIGN_IN) {
      setCurrentTab('home');
    }

    lastUserIdRef.current = nextUserId;
  }, [authLoading, user?.uid]);

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
      setIsManageSubscriptionOpen(false);
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

  if (!user && HARD_REQUIREMENT_GOOGLE_SIGN_IN) {
    return <SignInRequiredScreen onSignIn={handleSignIn} />;
  }

  if (isManageSubscriptionOpen) {
    return (
      <div className="h-screen w-full extension-gradient-bg">
        <ManageSubscription
          user={user}
          onBack={() => setIsManageSubscriptionOpen(false)}
        />
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
                <Home
                  user={user}
                  onOpenManageSubscription={() => setIsManageSubscriptionOpen(true)}
                />
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

        {user && (
          <>
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
          </>
        )}
      </ResizablePanelGroup>

      {/* Floating chat button when collapsed */}
      {user && isAIPanelCollapsed && currentTab === 'rules' && (
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
