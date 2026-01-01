import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Clock } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import type { Limit } from '../types/Limit';
import type { Group } from '../types/Group';
import { getNormalizedHostname, normalizeUrl } from '../utils/urlNormalization';
import { checkTyposquatting } from '../utils/typosquatting';
import { prepareUrl } from '../utils/urlValidation';
import Spinner from '../components/Spinner';
import { ItemListInput } from '../components/ItemListInput';
import { GroupIcons } from '../components/GroupIcons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

interface LimitsProps {
  user: User | null;
}

/**
 * Limits management tab. Child of Popup.tsx, renders inside the Limits tab.
 * Sibling to Groups.tsx and Home.tsx (other tabs).
 * Manages hard, soft, and session time limits on URLs and groups.
 */
const Limits: React.FC<LimitsProps> = ({ user }) => {
  const [limits, setLimits] = useState<Limit[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);

  // Create/Edit form state
  const [targetInput, setTargetInput] = useState('');
  const [targetItems, setTargetItems] = useState<Array<{ type: 'url' | 'group'; id: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [limitType, setLimitType] = useState<'hard' | 'soft' | 'session'>('hard');
  const [timeLimit, setTimeLimit] = useState('60');
  const [plusOnes, setPlusOnes] = useState('3');
  const [plusOneMinutes, setPlusOneMinutes] = useState('5');
  const [plusOneSeconds, setPlusOneSeconds] = useState('0');
  const [formError, setFormError] = useState('');
  const [typosquattingWarning, setTyposquattingWarning] = useState<{
    url: string;
    suggestion: string;
    targetType: 'url' | 'group';
    targetId: string;
  } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [limitToDelete, setLimitToDelete] = useState<string | null>(null);

  // Fetch limits, groups, and URLs from Firestore
  useEffect(() => {
    const fetchData = async () => {
      if (!user?.uid) {
        setLoading(false);
        return;
      }

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const data = userDoc.data();
          const fetchedLimits = data.limits || [];
          setLimits(fetchedLimits);
          setGroups(data.groups || []);

          // Auto-open create form if no limits exist
          if (fetchedLimits.length === 0) {
            setShowCreateForm(true);
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.uid]);

  // Save limits to Firestore
  const saveLimitsToFirestore = async (newLimits: Limit[]) => {
    if (!user?.uid) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, { limits: newLimits }, { merge: true });
    } catch (error) {
      console.error('Error saving limits:', error);
    }
  };

  // Get matching group suggestions
  const getGroupSuggestions = () => {
    if (!targetInput.trim()) return [];

    const input = targetInput.toLowerCase();
    return groups.filter(group =>
      group.name.toLowerCase().includes(input) &&
      !limits.some(l => l.targetId === group.id)
    );
  };

  // Add normalized URL to target items list
  const addNormalizedUrlToList = async (url: string) => {
    const normalizedUrl = normalizeUrl(url);

    // Check if URL is already in target items
    if (targetItems.some(item => item.id === normalizedUrl)) {
      setFormError('This URL is already in the list');
      return;
    }

    // Check if URL already has a limit
    if (limits.some(l => l.targetId === normalizedUrl)) {
      setFormError('This URL already has a limit');
      return;
    }

    // Add to list
    setTargetItems([...targetItems, { type: 'url', id: normalizedUrl }]);
    setTargetInput('');
    setFormError('');
    setTyposquattingWarning(null);
  };

  // Add target from input to the list
  const handleAddTargetToList = async () => {
    if (!targetInput.trim()) return;

    const input = targetInput.trim();
    setFormError('');

    // Check if it's a group name
    const matchingGroup = groups.find(
      g => g.name.toLowerCase() === input.toLowerCase()
    );

    if (matchingGroup) {
      // Check if already in list
      if (targetItems.some(item => item.id === matchingGroup.id)) {
        setFormError('This group is already in the list');
        return;
      }

      // Check if already has a limit
      if (limits.some(l => l.targetId === matchingGroup.id)) {
        setFormError('This group already has a limit');
        return;
      }

      // Add to list
      setTargetItems([...targetItems, { type: 'group', id: matchingGroup.id }]);
      setTargetInput('');
      setFormError('');
    } else {
      // It's a URL
      try {
        const preparedUrl = prepareUrl(input);

        // Check for typosquatting
        const typoCheck = checkTyposquatting(preparedUrl);
        if (typoCheck.isSuspicious && typoCheck.suggestion) {
          setTyposquattingWarning({
            url: preparedUrl,
            suggestion: typoCheck.suggestion + '.com',
            targetType: 'url',
            targetId: preparedUrl,
          });
          return;
        }

        // Add the URL
        await addNormalizedUrlToList(preparedUrl);
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Invalid URL');
      }
    }
  };

  // Remove target from list
  const handleRemoveTargetFromList = (targetId: string) => {
    setTargetItems(targetItems.filter(item => item.id !== targetId));
  };

  // Get display name for a target
  const getTargetDisplayName = (targetId: string, targetType: 'url' | 'group'): string => {
    if (targetType === 'url') {
      return targetId.replace(/^https?:\/\//, '');
    } else {
      const group = groups.find(g => g.id === targetId);
      return group?.name || 'Unknown group';
    }
  };

  // Handle Tab key to auto-fill top suggestion
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && groupSuggestions.length > 0) {
      e.preventDefault();
      setTargetInput(groupSuggestions[0].name);
      setShowSuggestions(false);
      setFormError('');
    }
  };

  // Actually save the limit (called after typosquatting check or directly)
  const saveLimitWithTarget = async (targetType: 'url' | 'group', targetId: string) => {
    // For session limits, time limit is set when visiting the site
    // For hard/soft limits, validate time limit
    let timeLimitNum = 0;
    if (limitType !== 'session') {
      timeLimitNum = parseInt(timeLimit);
      if (isNaN(timeLimitNum) || timeLimitNum <= 0) {
        setFormError('Please enter a valid time limit');
        return;
      }
    }

    // Calculate plus-one duration in seconds for soft limits
    let plusOneDurationSeconds: number | undefined;
    if (limitType === 'soft') {
      const minutes = parseInt(plusOneMinutes) || 0;
      const seconds = parseInt(plusOneSeconds) || 0;
      plusOneDurationSeconds = minutes * 60 + seconds;

      if (plusOneDurationSeconds <= 0) {
        setFormError('Plus-one duration must be greater than 0');
        return;
      }
    }

    if (editingLimitId) {
      // Update existing limit
      const updatedLimits = limits.map(limit => {
        if (limit.id === editingLimitId) {
          return {
            ...limit,
            type: limitType,
            targetType: targetType,
            targetId: targetId,
            timeLimit: timeLimitNum,
            plusOnes: limitType === 'soft' ? parseInt(plusOnes) : undefined,
            plusOneDuration: plusOneDurationSeconds,
          };
        }
        return limit;
      });
      setLimits(updatedLimits);
      await saveLimitsToFirestore(updatedLimits);
    } else {
      // Create new limit
      const newLimit: Limit = {
        id: `limit:${Date.now()}`,
        type: limitType,
        targetType: targetType,
        targetId: targetId,
        timeLimit: timeLimitNum,
        plusOnes: limitType === 'soft' ? parseInt(plusOnes) : undefined,
        plusOneDuration: plusOneDurationSeconds,
        createdAt: new Date().toISOString(),
      };

      const updatedLimits = [...limits, newLimit];
      setLimits(updatedLimits);
      await saveLimitsToFirestore(updatedLimits);
    }

    // Reset form
    setTyposquattingWarning(null);
    resetForm();
  };

  // Create or update limit
  const handleCreateLimit = async () => {
    if (targetItems.length === 0) {
      setFormError('Please add at least one URL or group');
      return;
    }

    // For session limits, time limit is set when visiting the site
    // For hard/soft limits, validate time limit
    let timeLimitNum = 0;
    if (limitType !== 'session') {
      timeLimitNum = parseInt(timeLimit);
      if (isNaN(timeLimitNum) || timeLimitNum <= 0) {
        setFormError('Please enter a valid time limit');
        return;
      }
    }

    // Calculate plus-one duration in seconds for soft limits
    let plusOneDurationSeconds: number | undefined;
    if (limitType === 'soft') {
      const minutes = parseInt(plusOneMinutes) || 0;
      const seconds = parseInt(plusOneSeconds) || 0;
      plusOneDurationSeconds = minutes * 60 + seconds;

      if (plusOneDurationSeconds <= 0) {
        setFormError('Plus-one duration must be greater than 0');
        return;
      }
    }

    // Create a limit for each target
    const newLimits: Limit[] = targetItems.map((target, index) => ({
      id: `limit:${Date.now() + index}`,
      type: limitType,
      targetType: target.type,
      targetId: target.id,
      timeLimit: timeLimitNum,
      plusOnes: limitType === 'soft' ? parseInt(plusOnes) : undefined,
      plusOneDuration: plusOneDurationSeconds,
      createdAt: new Date().toISOString(),
    }));

    const updatedLimits = [...limits, ...newLimits];
    setLimits(updatedLimits);
    await saveLimitsToFirestore(updatedLimits);

    // Reset form
    setTyposquattingWarning(null);
    resetForm();
  };

  // Delete limit
  const handleDeleteLimit = async () => {
    if (!limitToDelete) return;

    const updatedLimits = limits.filter(l => l.id !== limitToDelete);
    setLimits(updatedLimits);
    await saveLimitsToFirestore(updatedLimits);
    setDeleteDialogOpen(false);
    setLimitToDelete(null);
  };


  // Format plus-one duration from seconds to human-readable string
  const formatPlusOneDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins > 0 && secs > 0) {
      return `${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m`;
    } else {
      return `${secs}s`;
    }
  };

  // Format seconds to always display as 2 digits
  const formatSecondsDisplay = (value: string): string => {
    return value.toString().padStart(2, '0');
  };

  // Validate and sanitize seconds input
  const handleSecondsInput = (inputValue: string): string => {
    const sanitized = inputValue.replace(/\D/g, ''); // Remove non-digits
    if (sanitized === '' || (parseInt(sanitized) >= 0 && parseInt(sanitized) <= 59)) {
      return sanitized;
    }
    return plusOneSeconds; // Return previous value if invalid
  };

  // Start editing a limit
  const handleEditLimit = (limit: Limit) => {
    setEditingLimitId(limit.id);

    // Populate form with limit data
    setLimitType(limit.type);
    setTimeLimit(limit.timeLimit.toString());

    if (limit.type === 'soft' && limit.plusOnes !== undefined) {
      setPlusOnes(limit.plusOnes.toString());

      if (limit.plusOneDuration !== undefined) {
        const mins = Math.floor(limit.plusOneDuration / 60);
        const secs = limit.plusOneDuration % 60;
        setPlusOneMinutes(mins.toString());
        setPlusOneSeconds(secs.toString());
      }
    }

    // Set target input based on type
    if (limit.targetType === 'url') {
      setTargetInput(limit.targetId);
    } else {
      const group = groups.find(g => g.id === limit.targetId);
      if (group) {
        setTargetInput(group.name);
      }
    }

    setShowCreateForm(true);
  };

  // Reset form to initial state
  const resetForm = () => {
    setShowCreateForm(false);
    setEditingLimitId(null);
    setTargetInput('');
    setTargetItems([]);
    setShowSuggestions(false);
    setLimitType('hard');
    setTimeLimit('60');
    setPlusOnes('3');
    setPlusOneMinutes('5');
    setPlusOneSeconds('0');
    setFormError('');
    setTyposquattingWarning(null);
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const groupSuggestions = getGroupSuggestions();

  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Limits</h3>
        <button
          onClick={() => {
            if (showCreateForm) {
              resetForm();
            } else {
              setShowCreateForm(true);
              setEditingLimitId(null);
            }
          }}
          className="purple-button"
          title="Create Limit"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Create/Edit Limit Form */}
      {showCreateForm && (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 space-y-3">
          <h4 className="text-white font-medium">{editingLimitId ? 'Edit Limit' : 'Create New Limit'}</h4>

          {/* Target Input with List */}
          <div>
            <label className="block text-gray-400 text-xs mb-1">URLs or Group Names</label>
            <div className="relative">
              <ItemListInput
                items={targetItems.map(t => t.id)}
                inputValue={targetInput}
                onInputChange={(value) => {
                  setTargetInput(value);
                  setShowSuggestions(true);
                  setFormError('');
                }}
                onAddItem={handleAddTargetToList}
                onRemoveItem={handleRemoveTargetFromList}
                onKeyDown={handleInputKeyDown}
                placeholder={`e.g. youtube.com or ${groups.length > 0 ? groups[groups.length - 1].name : '[custom group]'}`}
                error={formError}
                renderItem={(itemId) => {
                  const item = targetItems.find(t => t.id === itemId);
                  if (!item) return null;

                  const group = item.type === 'group' ? groups.find(g => g.id === item.id) : null;

                  return (
                    <div className="flex items-center gap-2 py-2 px-3 bg-slate-600 rounded-lg">
                      {item.type === 'url' ? (
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${getNormalizedHostname(item.id)}&sz=32`}
                          alt=""
                          className="w-4 h-4"
                          onError={(e) => {
                            e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23666"/></svg>';
                          }}
                        />
                      ) : group ? (
                        <GroupIcons group={group} allGroups={groups} iconSize="sm" maxIcons={3} />
                      ) : null}
                      <span className="flex-1 text-white text-sm">
                        {getTargetDisplayName(item.id, item.type)}
                      </span>
                      <button
                        onClick={() => handleRemoveTargetFromList(item.id)}
                        className="text-gray-400 hover:text-white transition-colors"
                      >
                        <span className="text-xs">✕</span>
                      </button>
                    </div>
                  );
                }}
              />

              {/* Group Suggestions */}
              {showSuggestions && groupSuggestions.length > 0 && (
                <div className="absolute top-12 left-0 right-0 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  <div className="px-3 py-1 text-xs text-gray-400 border-b border-gray-600">
                    Matching Groups
                  </div>
                  {groupSuggestions.map(group => (
                    <button
                      key={group.id}
                      onClick={() => {
                        setTargetInput(group.name);
                        setShowSuggestions(false);
                        setFormError('');
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                    >
                      <span className="font-medium">{group.name}</span>
                      <span className="text-xs text-gray-400">({group.items.length} items)</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Typosquatting Warning */}
              {typosquattingWarning && (
                <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-3 space-y-3 mt-2">
                  <div className="flex items-start gap-2">
                    <span className="text-yellow-500 text-xl">⚠️</span>
                    <div className="flex-1">
                      <p className="text-yellow-100 text-sm font-medium mb-1">
                        Possible typo detected
                      </p>
                      <p className="text-yellow-200 text-xs">
                        Did you mean <span className="font-bold">{typosquattingWarning.suggestion}</span>?
                      </p>
                      <p className="text-yellow-300 text-xs mt-1">
                        You entered: {typosquattingWarning.url.replace(/^https?:\/\//, '')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        const correctedUrl = 'https://' + typosquattingWarning.suggestion;
                        await addNormalizedUrlToList(correctedUrl);
                      }}
                      className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg"
                    >
                      Use {typosquattingWarning.suggestion}
                    </button>
                    <button
                      onClick={async () => {
                        await addNormalizedUrlToList(typosquattingWarning.url);
                      }}
                      className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg"
                    >
                      Keep original
                    </button>
                    <button
                      onClick={() => {
                        setTyposquattingWarning(null);
                      }}
                      className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Limit Type Selection */}
          <div>
            <label className="block text-gray-400 text-xs mb-1">Limit Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setLimitType('hard')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                  limitType === 'hard'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Hard
              </button>
              <button
                onClick={() => setLimitType('soft')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                  limitType === 'soft'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Soft
              </button>
              <button
                onClick={() => setLimitType('session')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                  limitType === 'session'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Session
              </button>
            </div>
          </div>

          {/* Time Limit (hidden for session limits) */}
          {limitType !== 'session' && (
            <div>
              <label className="block text-gray-400 text-xs mb-1">Time Limit (minutes)</label>
              <input
                type="number"
                value={timeLimit}
                onChange={(e) => setTimeLimit(e.target.value)}
                min="1"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Session limit explanation */}
          {limitType === 'session' && (
            <div className="bg-blue-900 border border-blue-600 rounded-lg p-2">
              <p className="text-blue-200 text-xs">
                Session limits prompt you to set a time limit when you visit the site
              </p>
            </div>
          )}

          {/* Plus Ones (for soft limits) */}
          {limitType === 'soft' && (
            <div>
              <style dangerouslySetInnerHTML={{__html: `
                .no-spinner::-webkit-outer-spin-button,
                .no-spinner::-webkit-inner-spin-button {
                  -webkit-appearance: none;
                  margin: 0;
                }
                .no-spinner[type=number] {
                  -moz-appearance: textfield;
                  appearance: textfield;
                }
                .time-input:focus {
                  background-color: rgba(59, 130, 246, 0.1);
                  border-radius: 4px;
                  outline: 1px solid rgba(59, 130, 246, 0.3);
                  outline-offset: 1px;
                }
              `}} />

              <div className="flex items-start gap-2 text-sm">
                <span className="text-gray-300 pt-1">Allow</span>

                {/* Number of plus ones */}
                <div className="flex flex-col items-center">
                  <input
                    type="number"
                    value={plusOnes}
                    onChange={(e) => setPlusOnes(e.target.value)}
                    min="0"
                    placeholder="3"
                    className="no-spinner w-12 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                  <span className="text-xs text-gray-400 mt-1">Number</span>
                </div>

                <span className="text-gray-300 pt-1">×</span>

                {/* Duration with built-in colon separator */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center bg-gray-800 border border-gray-600 rounded px-2 py-1 shadow-inner focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
                    <input
                      type="number"
                      value={plusOneMinutes}
                      onChange={(e) => setPlusOneMinutes(e.target.value)}
                      min="0"
                      placeholder="5"
                      className="time-input no-spinner bg-transparent text-white text-sm text-center focus:outline-none w-7"
                      onWheel={(e) => e.currentTarget.blur()}
                    />
                    <span className="text-gray-400 text-sm font-semibold select-none">:</span>
                    <input
                      type="text"
                      value={formatSecondsDisplay(plusOneSeconds)}
                      onChange={(e) => setPlusOneSeconds(handleSecondsInput(e.target.value))}
                      onBlur={(e) => {
                        // Ensure it's always 2 digits on blur
                        if (e.target.value && e.target.value.length === 1) {
                          setPlusOneSeconds(e.target.value.padStart(2, '0'));
                        }
                      }}
                      maxLength={2}
                      placeholder="00"
                      className="time-input no-spinner bg-transparent text-white text-sm text-center focus:outline-none w-7"
                    />
                  </div>
                  <span className="text-xs text-gray-400 mt-1">Duration</span>
                </div>

                <span className="text-gray-300 pt-1">extensions</span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {formError && (
            <p className="text-red-400 text-sm">{formError}</p>
          )}

          {/* Typosquatting Warning Dialog */}
          {typosquattingWarning && (
            <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-3 space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-yellow-500 text-xl">⚠️</span>
                <div className="flex-1">
                  <p className="text-yellow-100 text-sm font-medium mb-1">
                    Possible typo detected
                  </p>
                  <p className="text-yellow-200 text-xs">
                    Did you mean <span className="font-bold">{typosquattingWarning.suggestion}</span>?
                  </p>
                  <p className="text-yellow-300 text-xs mt-1">
                    You entered: {typosquattingWarning.url.replace(/^https?:\/\//, '')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    // Use the suggested correct domain
                    const correctedUrl = 'https://' + typosquattingWarning.suggestion;
                    await saveLimitWithTarget('url', correctedUrl);
                  }}
                  className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg"
                >
                  Use {typosquattingWarning.suggestion}
                </button>
                <button
                  onClick={async () => {
                    // User confirms they want to use the original (potentially misspelled) URL
                    await saveLimitWithTarget('url', typosquattingWarning.url);
                  }}
                  className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg"
                >
                  Keep original
                </button>
                <button
                  onClick={() => {
                    // Cancel and go back to editing
                    setTyposquattingWarning(null);
                  }}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleCreateLimit}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
            >
              {editingLimitId ? 'Update Limit' : 'Create Limit'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Limits List */}
      <div className="flex flex-col space-y-2">
        {limits.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            No limits set. Create one to get started!
          </p>
        ) : (
          limits.map((limit) => (
            <div
              key={limit.id}
              onClick={() => handleEditLimit(limit)}
              className="bg-slate-700 hover:bg-slate-600 rounded-lg p-3 flex items-center gap-3 cursor-pointer"
            >
              {/* Icon */}
              <div className={`p-2 rounded-lg ${
                limit.type === 'hard' ? 'bg-red-600' :
                limit.type === 'soft' ? 'bg-yellow-600' :
                'bg-blue-600'
              }`}>
                <Clock size={16} className="text-white" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {limit.targetType === 'url' ? (
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${getNormalizedHostname(limit.targetId)}&sz=32`}
                      alt=""
                      className="w-4 h-4"
                      onError={(e) => {
                        e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23666"/></svg>';
                      }}
                    />
                  ) : (
                    (() => {
                      const group = groups.find(g => g.id === limit.targetId);
                      return group ? <GroupIcons group={group} allGroups={groups} iconSize="sm" maxIcons={3} /> : null;
                    })()
                  )}
                  <span className="text-white text-sm font-medium truncate">
                    {getTargetDisplayName(limit.targetId, limit.targetType)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400">
                    {limit.type.charAt(0).toUpperCase() + limit.type.slice(1)}
                    {limit.type !== 'session' && ` • ${limit.timeLimit} min`}
                    {limit.type === 'session' && ' • Set on visit'}
                    {limit.type === 'soft' && limit.plusOnes !== undefined && ` • ${limit.plusOnes} plus ones`}
                    {limit.type === 'soft' && limit.plusOneDuration !== undefined && ` (${formatPlusOneDuration(limit.plusOneDuration)} each)`}
                  </span>
                </div>
              </div>

              {/* Delete Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLimitToDelete(limit.id);
                  setDeleteDialogOpen(true);
                }}
                className="text-gray-400 hover:text-red-400 transition-colors"
                title="Delete Limit"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-gray-800 border-gray-600 text-white" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-white">Delete Limit?</DialogTitle>
            <DialogDescription className="text-gray-300">
              Are you sure you want to delete this limit? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteDialogOpen(false);
                setLimitToDelete(null);
              }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteLimit();
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Limits;
