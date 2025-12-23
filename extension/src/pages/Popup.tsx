import React, { useState } from 'react';
import useAuth from '../hooks/useAuth';
import Home from './Home';
import Account from './Account';

const Popup: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [showAccount, setShowAccount] = useState(false);

  if (authLoading) {
    return <div className="h-screen w-full flex items-center justify-center">Loading...</div>;
  }

  if (showAccount) {
    return <Account onBack={() => setShowAccount(false)} />;
  }

  return <Home onShowAccount={() => setShowAccount(true)} user={user} />;
};

export default Popup;
