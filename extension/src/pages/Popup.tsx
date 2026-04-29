import React, { useState, useEffect, useRef, useCallback } from 'react';
import useAuth from '../hooks/useAuth';
import Home from './Home';
import Rules from './Rules';
import Groups from './Groups';
import GroupEdit from './GroupEdit';
import Settings from './Settings';
import ManageSubscription from './ManageSubscription';
import Spinner from '../components/Spinner';
import LLMPanel from '../components/LLMPanel';
import TutorialOverlay, { type TutorialStep } from '../components/TutorialOverlay';
import ExtensionUpdateModal from '../components/ExtensionUpdateModal';
import ClientMessageModal from '../components/ClientMessageModal';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../components/ui/resizable';
import { syncRulesToStorage } from '../utils/syncRulesToStorage';
import { Bot } from 'lucide-react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import {
  TUTORIAL_EXACT_PROMPT,
  TUTORIAL_INSTAGRAM_BADGE_STEP_KEY,
  TUTORIAL_INSTAGRAM_URL,
  TUTORIAL_STORAGE_KEY,
} from '../constants';
import {
  getExtensionClientModalState,
  markClientMessagePromptSeen,
  type ExtensionClientModalState,
} from '../utils/extensionUpdate';

type TabType = 'home' | 'rules' | 'settings';
type RulesView = 'rules' | 'groups' | 'groupEdit';
type ClientModalKind = 'upgrade' | 'message' | 'aiChatFocusMessage' | 'tutorialDisabledMessage';
const HARD_REQUIREMENT_GOOGLE_SIGN_IN = import.meta.env.HARD_REQUIREMENT_GOOGLE_SIGN_IN === 'true';

const getTutorialInstagramTabId = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') return null;

  const tabId = (value as { tabId?: unknown }).tabId;
  return typeof tabId === 'number' ? tabId : null;
};

function buildClientModalQueue(modalState: ExtensionClientModalState): ClientModalKind[] {
  const hasUpgradePrompt = Boolean(modalState.updatePrompt);
  const hasMessagePrompt = Boolean(modalState.messagePrompt);

  if (hasUpgradePrompt && hasMessagePrompt) {
    if (!modalState.showMessageModalIfUpgradeModalIsActive) {
      return ['upgrade'];
    }

    return modalState.showUpgradeModalBeforeMessageModal
      ? ['upgrade', 'message']
      : ['message', 'upgrade'];
  }

  if (hasUpgradePrompt) {
    return ['upgrade'];
  }

  if (hasMessagePrompt) {
    return ['message'];
  }

  return [];
}

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
  const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(null);
  const [tutorialPromptMismatch, setTutorialPromptMismatch] = useState(false);
  const [clientModalState, setClientModalState] = useState<ExtensionClientModalState | null>(null);
  const [clientModalQueue, setClientModalQueue] = useState<ClientModalKind[]>([]);
  const [hasLoadedClientModalState, setHasLoadedClientModalState] = useState(false);
  const [isAiChatInputFocused, setIsAiChatInputFocused] = useState(false);
  const aiPanelRef = useRef<ImperativePanelHandle>(null);
  const lastUserIdRef = useRef<string | null>(null);

  const saveTutorialStatus = (status: 'declined' | 'dismissed' | 'started' | 'completed') => {
    chrome.storage.local.set({
      [TUTORIAL_STORAGE_KEY]: {
        status,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const clearTutorialInstagramBadgeStep = () => {
    chrome.storage.local.remove(TUTORIAL_INSTAGRAM_BADGE_STEP_KEY);
  };

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

    lastUserIdRef.current = nextUserId;
  }, [authLoading, user?.uid]);

  useEffect(() => {
    let cancelled = false;

    getExtensionClientModalState()
      .then(modalState => {
        if (cancelled) {
          return;
        }

        setClientModalState(modalState);
        if (modalState) {
          setClientModalQueue(buildClientModalQueue(modalState));
        }
      })
      .catch(error => {
        console.error('Error checking extension client messages:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setHasLoadedClientModalState(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authLoading || !user?.uid) {
      setTutorialStep(null);
      return;
    }

    if (!hasLoadedClientModalState || clientModalState?.tutorialDisabledMessagePrompt) {
      return;
    }

    let cancelled = false;
    chrome.storage.local.get([TUTORIAL_STORAGE_KEY], (result) => {
      if (cancelled) return;

      const status = result[TUTORIAL_STORAGE_KEY]?.status;
      if (status === 'completed' || status === 'declined' || status === 'dismissed') {
        return;
      }

      setCurrentTab('rules');
      setRulesView('rules');
      setTutorialStep('invite');
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.uid, hasLoadedClientModalState, clientModalState?.tutorialDisabledMessagePrompt]);

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

  const startTutorial = () => {
    if (clientModalState?.tutorialDisabledMessagePrompt) {
      setClientModalQueue(prev => (
        prev.includes('tutorialDisabledMessage')
          ? prev
          : [...prev, 'tutorialDisabledMessage']
      ));
      return;
    }

    saveTutorialStatus('started');
    clearTutorialInstagramBadgeStep();
    setTutorialPromptMismatch(false);
    setCurrentTab('rules');
    setRulesView('rules');
    setEditingGroupId(null);
    setEditingFromRules(false);
    setEditingRuleIdBeforeGroupEdit(null);
    setIsAIPanelCollapsed(true);
    aiPanelRef.current?.collapse();
    setTutorialStep(null);

    window.setTimeout(() => {
      setTutorialStep('aiChatIntro');
    }, 120);
  };

  const declineTutorial = () => {
    saveTutorialStatus('declined');
    clearTutorialInstagramBadgeStep();
    setTutorialStep(null);
    setTutorialPromptMismatch(false);
  };

  const exitTutorial = () => {
    saveTutorialStatus(tutorialStep === 'complete' ? 'completed' : 'dismissed');
    clearTutorialInstagramBadgeStep();
    setTutorialStep(null);
    setTutorialPromptMismatch(false);
  };

  const finishTutorial = () => {
    saveTutorialStatus('completed');
    clearTutorialInstagramBadgeStep();
    setTutorialStep(null);
    setTutorialPromptMismatch(false);
  };

  const showCompanionWebAppStep = () => {
    setTutorialStep(null);

    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('[data-tutorial-target="companion-web-app-link"]')
        ?.scrollIntoView({ block: 'center' });
      setTutorialStep('companionWebApp');
    }, 120);
  };

  const continueTutorial = () => {
    if (tutorialStep === 'aiChatIntro') {
      setTutorialStep(null);
      setIsAIPanelCollapsed(false);
      aiPanelRef.current?.resize(46);
      window.setTimeout(() => {
        setTutorialStep('prompt');
        document.querySelector<HTMLTextAreaElement>('[data-tutorial-target="ai-input"]')?.focus();
      }, 160);
      return;
    }

    if (tutorialStep === 'replayTutorial') {
      showCompanionWebAppStep();
      return;
    }

    if (tutorialStep === 'companionWebApp') {
      setTutorialStep('complete');
    }
  };

  const collapseAssistantPanel = useCallback(() => {
    setIsAIPanelCollapsed(true);
    aiPanelRef.current?.collapse();
    aiPanelRef.current?.resize(0);
  }, []);

  const showOpenRuleTutorialStep = useCallback(() => {
    setCurrentTab('rules');
    setRulesView('rules');
    setTutorialStep(null);
    collapseAssistantPanel();
    window.setTimeout(collapseAssistantPanel, 80);
    window.setTimeout(() => {
      collapseAssistantPanel();
      document
        .querySelector<HTMLElement>('[data-tutorial-target="social-media-rule-card"]')
        ?.scrollIntoView({ block: 'center' });
      setTutorialStep('openRule');
    }, 220);
  }, [collapseAssistantPanel]);

  const handleTutorialPromptAccepted = () => {
    setTutorialPromptMismatch(false);
    setIsAiChatInputFocused(false);
    setCurrentTab('rules');
    setRulesView('rules');
    setTutorialStep(null);
    collapseAssistantPanel();
    window.setTimeout(collapseAssistantPanel, 80);
    window.setTimeout(() => {
      collapseAssistantPanel();
      setTutorialStep('openInstagram');
    }, 220);
  };

  const handleTutorialPromptReadyChange = useCallback((isReady: boolean) => {
    setTutorialStep(prevStep => {
      if (isReady && prevStep === 'prompt') {
        return 'sendPrompt';
      }

      if (!isReady && prevStep === 'sendPrompt') {
        return 'prompt';
      }

      return prevStep;
    });

    if (isReady) {
      setTutorialPromptMismatch(false);
    }
  }, []);

  const openTutorialInstagram = () => {
    chrome.tabs.create({ url: TUTORIAL_INSTAGRAM_URL }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to open tutorial Instagram tab:', chrome.runtime.lastError.message);
        return;
      }

      const nextStepState: {
        status: 'armed';
        updatedAt: string;
        tabId?: number;
        windowId?: number;
      } = {
        status: 'armed',
        updatedAt: new Date().toISOString(),
      };

      if (typeof tab.id === 'number') {
        nextStepState.tabId = tab.id;
      }

      if (typeof tab.windowId === 'number') {
        nextStepState.windowId = tab.windowId;
      }

      chrome.storage.local.set({
        [TUTORIAL_INSTAGRAM_BADGE_STEP_KEY]: nextStepState,
      });
    });
  };

  const showReplayTutorialStep = () => {
    saveTutorialStatus('started');
    setTutorialPromptMismatch(false);
    setCurrentTab('settings');
    setRulesView('rules');
    setEditingGroupId(null);
    setEditingFromRules(false);
    setEditingRuleIdBeforeGroupEdit(null);
    setIsAIPanelCollapsed(true);
    aiPanelRef.current?.collapse();
    setTutorialStep(null);

    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('[data-tutorial-target="replay-tutorial-button"]')
        ?.scrollIntoView({ block: 'center' });
      setTutorialStep('replayTutorial');
    }, 120);
  };

  const closeClientModal = async () => {
    const activeModal = clientModalQueue[0];

    if (activeModal === 'message' && clientModalState?.messagePrompt) {
      await markClientMessagePromptSeen(clientModalState.messagePrompt.message);
    }

    setClientModalQueue(prev => prev.slice(1));
  };

  const queueAiChatFocusModal = useCallback((modalState: ExtensionClientModalState | null) => {
    if (tutorialStep || !modalState?.aiChatFocusMessagePrompt) {
      return;
    }

    setClientModalQueue(prev => (
      prev.includes('aiChatFocusMessage')
        ? prev
        : [...prev, 'aiChatFocusMessage']
    ));
  }, [tutorialStep]);

  useEffect(() => {
    if (isAiChatInputFocused) {
      queueAiChatFocusModal(clientModalState);
    }
  }, [clientModalState, isAiChatInputFocused, queueAiChatFocusModal]);

  useEffect(() => {
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      const nextValue = changes[TUTORIAL_INSTAGRAM_BADGE_STEP_KEY]?.newValue;
      const nextStatus = nextValue?.status;
      if (tutorialStep === 'openInstagram' && nextStatus === 'completed') {
        const tabId = getTutorialInstagramTabId(nextValue);
        if (tabId !== null) {
          chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
              console.debug('Tutorial Instagram tab was already closed:', chrome.runtime.lastError.message);
            }
          });
        }

        showOpenRuleTutorialStep();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [showOpenRuleTutorialStep, tutorialStep]);

  const handleAiChatFocus = () => {
    setIsAiChatInputFocused(true);
    queueAiChatFocusModal(clientModalState);
  };

  const handleAiChatBlur = () => {
    setIsAiChatInputFocused(false);
  };

  const activeClientModal = clientModalQueue[0] || null;

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
                  tutorialStep={tutorialStep}
                  onTutorialRuleOpened={() => {
                    if (tutorialStep === 'openRule') {
                      setTutorialStep('makeSoft');
                    }
                  }}
                  onTutorialSoftSelected={() => {
                    if (tutorialStep === 'makeSoft') {
                      setTutorialStep('setPlusOneCount');
                    }
                  }}
                  onTutorialPlusOneCountConfigured={() => {
                    if (tutorialStep === 'setPlusOneCount') {
                      setTutorialStep('saveSoft');
                    }
                  }}
                  onTutorialRuleSaved={() => {
                    if (tutorialStep === 'saveSoft') {
                      showReplayTutorialStep();
                    }
                  }}
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
                <Settings
                  user={user}
                  isTutorialReplayDisabled={Boolean(tutorialStep) || !hasLoadedClientModalState}
                  onReplayTutorial={startTutorial}
                />
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
                tutorialExpectedPrompt={tutorialStep === 'prompt' || tutorialStep === 'sendPrompt' ? TUTORIAL_EXACT_PROMPT : undefined}
                onTutorialPromptAccepted={handleTutorialPromptAccepted}
                onTutorialPromptMismatch={(isMismatch) => setTutorialPromptMismatch(isMismatch)}
                onTutorialPromptReadyChange={handleTutorialPromptReadyChange}
                onAiChatFocus={handleAiChatFocus}
                onAiChatBlur={handleAiChatBlur}
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
          data-tutorial-target="ai-open-button"
          className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-white shadow-lg transition-all hover:scale-110 hover:bg-zinc-700"
          title="Open AI Assistant"
        >
          <Bot className="w-6 h-6" />
        </button>
      )}

      {tutorialStep && (
        <TutorialOverlay
          step={tutorialStep}
          promptMismatch={tutorialPromptMismatch}
          onStart={startTutorial}
          onDecline={declineTutorial}
          onExit={exitTutorial}
          onContinue={continueTutorial}
          onFinish={finishTutorial}
          onOpenInstagram={openTutorialInstagram}
        />
      )}

      {activeClientModal === 'upgrade' && clientModalState?.updatePrompt && (
        <ExtensionUpdateModal
          prompt={clientModalState.updatePrompt}
          onClose={() => {
            void closeClientModal();
          }}
        />
      )}

      {activeClientModal === 'message' && clientModalState?.messagePrompt && (
        <ClientMessageModal
          prompt={clientModalState.messagePrompt}
          onClose={() => {
            void closeClientModal();
          }}
        />
      )}

      {activeClientModal === 'aiChatFocusMessage' && clientModalState?.aiChatFocusMessagePrompt && (
        <ClientMessageModal
          prompt={clientModalState.aiChatFocusMessagePrompt}
          onClose={() => {
            void closeClientModal();
          }}
        />
      )}

      {activeClientModal === 'tutorialDisabledMessage' && clientModalState?.tutorialDisabledMessagePrompt && (
        <ClientMessageModal
          prompt={clientModalState.tutorialDisabledMessagePrompt}
          onClose={() => {
            void closeClientModal();
          }}
        />
      )}
    </div>
  );
};

export default Popup;
