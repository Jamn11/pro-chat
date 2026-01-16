import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react'
import type { ReactNode } from 'react'

type AuthGuardProps = {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  return (
    <>
      <SignedOut>
        <div className="auth-container">
          <div className="auth-card">
            <h1 className="auth-title">Pro Chat</h1>
            <p className="auth-subtitle">Sign in to continue</p>
            <SignIn 
              routing="hash" 
              appearance={{
                elements: {
                  rootBox: 'auth-clerk-root',
                  card: 'auth-clerk-card',
                }
              }}
            />
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        {children}
      </SignedIn>
    </>
  )
}

export function UserMenu() {
  return (
    <UserButton 
      afterSignOutUrl="/"
      appearance={{
        elements: {
          avatarBox: 'user-avatar',
        }
      }}
    />
  )
}
