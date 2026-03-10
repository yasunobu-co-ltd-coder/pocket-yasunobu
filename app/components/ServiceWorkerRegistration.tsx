'use client';

import { useEffect, useState } from 'react';

export function ServiceWorkerRegistration() {
    const [showUpdate, setShowUpdate] = useState(false);
    const [waitingSW, setWaitingSW] = useState<ServiceWorker | null>(null);

    useEffect(() => {
        if (!('serviceWorker' in navigator)) return;

        navigator.serviceWorker
            .register('/sw.js')
            .then((registration) => {
                console.log('Service Worker registered:', registration.scope);

                // 新しいSWがインストール済みで待機中の場合
                if (registration.waiting) {
                    setWaitingSW(registration.waiting);
                    setShowUpdate(true);
                }

                // 新しいSWが見つかった場合
                registration.addEventListener('updatefound', () => {
                    const newSW = registration.installing;
                    if (!newSW) return;

                    newSW.addEventListener('statechange', () => {
                        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                            // 新しいSWがインストール完了 → 更新通知を表示
                            setWaitingSW(newSW);
                            setShowUpdate(true);
                        }
                    });
                });
            })
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });

        // 新しいSWがcontrollerになったら自動リロード（ループ防止付き）
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });
    }, []);

    const handleUpdate = () => {
        if (waitingSW) {
            waitingSW.postMessage({ type: 'SKIP_WAITING' });
        }
    };

    if (!showUpdate) return null;

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#1e293b',
                color: '#fff',
                padding: '12px 20px',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '14px',
                maxWidth: '90vw',
            }}
        >
            <span>新しいバージョンがあります</span>
            <button
                onClick={handleUpdate}
                style={{
                    padding: '6px 16px',
                    background: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '13px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                }}
            >
                更新
            </button>
        </div>
    );
}
