/**
 * Authentication Modal Provider
 * Provides global authentication modal management
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { SignInView } from './AuthForm';
import { LoginModal } from './login-modal';
import { useAuth } from '../../contexts/auth-context';
import { setGlobalAuthModalTrigger } from '../../lib/api-client';

export interface ShowAuthModalOptions {
  /** The view to open in; sign-in when absent. Signing up has its own page. */
  initialMode?: SignInView;
}

interface AuthModalContextType {
  showAuthModal: (context?: string, onSuccess?: () => void, intendedUrl?: string, options?: ShowAuthModalOptions) => void;
  hideAuthModal: () => void;
  isAuthModalOpen: boolean;
}

const AuthModalContext = createContext<AuthModalContextType | undefined>(undefined);

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (context === undefined) {
    throw new Error('useAuthModal must be used within an AuthModalProvider');
  }
  return context;
}

interface AuthModalProviderProps {
  children: React.ReactNode;
}

export function AuthModalProvider({ children }: AuthModalProviderProps) {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<(() => void) | undefined>();
  const [intendedUrl, setIntendedUrlState] = useState<string | undefined>();
  const [initialMode, setInitialMode] = useState<SignInView>('login');
  // The session the window was opened from, when it should stay open for a signed-in visitor.
  const [heldSessionId, setHeldSessionId] = useState<string | null>(null);
  const {
    login,
    clearError,
    isAuthenticated,
    session,
    setIntendedUrl,
    clearIntendedUrl,
  } = useAuth();
  const navigate = useNavigate();
  const sessionId = session?.sessionId ?? null;

  const showAuthModal = useCallback((context?: string, onSuccess?: () => void, intendedUrl?: string, options?: ShowAuthModalOptions) => {
    setModalContext(context);
    setPendingAction(onSuccess ? () => onSuccess : undefined);
    setIntendedUrlState(intendedUrl);
    setInitialMode(options?.initialMode ?? 'login');
    // A signed-in visitor may still request a reset link; any other view closes once a session exists.
    setHeldSessionId(options?.initialMode === 'forgot' ? sessionId : null);
    // Email sign-in and sign-up navigate to the stored URL once the session is set.
    if (intendedUrl) {
      setIntendedUrl(intendedUrl);
    } else {
      clearIntendedUrl();
    }
    setIsAuthModalOpen(true);
  }, [setIntendedUrl, clearIntendedUrl, sessionId]);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setModalContext(undefined);
    setPendingAction(undefined);
    setIntendedUrlState(undefined);
    setHeldSessionId(null);
    clearError();
  }, [clearError]);

  // Dismissed without signing in, so the visitor isn't sent there on a later sign-in.
  const hideAuthModal = useCallback(() => {
    closeAuthModal();
    clearIntendedUrl();
  }, [closeAuthModal, clearIntendedUrl]);

  // "Create an account" leaves for the sign-up page and keeps the stored destination, so signing up lands there.
  const goToSignup = useCallback(() => {
    closeAuthModal();
    navigate('/signup');
  }, [closeAuthModal, navigate]);

  // Close modal and execute pending action when user becomes authenticated
  useEffect(() => {
    if (isAuthenticated && isAuthModalOpen && sessionId !== heldSessionId) {
      closeAuthModal();
      // Execute the pending action after a brief delay to ensure modal is closed
      if (pendingAction) {
        setTimeout(() => {
          pendingAction();
        }, 100);
      }
    }
  }, [isAuthenticated, pendingAction, isAuthModalOpen, closeAuthModal, sessionId, heldSessionId]);

  const handleLogin = useCallback((provider: 'google' | 'github' | 'cloudflare', redirectUrl?: string) => {
    // Use the intended URL if available, otherwise use the provided redirect URL
    const finalRedirectUrl = intendedUrl || redirectUrl;
    login(provider, finalRedirectUrl);
  }, [login, intendedUrl]);

  // Set up global auth modal trigger for API client
  useEffect(() => {
    setGlobalAuthModalTrigger(showAuthModal);
  }, [showAuthModal]);

  const value: AuthModalContextType = {
    showAuthModal,
    hideAuthModal,
    isAuthModalOpen,
  };

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <LoginModal
        isOpen={isAuthModalOpen}
        onClose={hideAuthModal}
        onOAuthLogin={handleLogin}
        onCreateAccount={goToSignup}
        actionContext={modalContext}
        initialMode={initialMode}
      />
    </AuthModalContext.Provider>
  );
}