import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import {
    generateMobilePairingCode,
    getMobilePairingStatus,
} from "../api/mobile-chat.js";
import { fetchPrivacyMode } from "../api/settings.js";
import { Modal } from "./Modal.js";

interface MobileBindingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onBindingSuccess: () => void;
}

export function MobileBindingModal({ isOpen, onClose, onBindingSuccess }: MobileBindingModalProps) {
    const { t } = useTranslation();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [existingCount, setExistingCount] = useState(0);
    const [privacyMode, setPrivacyMode] = useState(false);
    const [qrRevealed, setQrRevealed] = useState(false);

    const pollIntervalRef = useRef<number | null>(null);
    const baseCountRef = useRef(0);
    // Stable ref for onBindingSuccess to avoid re-triggering useEffect
    const onBindingSuccessRef = useRef(onBindingSuccess);
    onBindingSuccessRef.current = onBindingSuccess;

    // Load privacy mode setting and listen for changes
    useEffect(() => {
        fetchPrivacyMode().then(setPrivacyMode).catch(() => {});

        function onPrivacyChanged() {
            fetchPrivacyMode().then(setPrivacyMode).catch(() => {});
        }
        window.addEventListener("privacy-settings-changed", onPrivacyChanged);
        return () => window.removeEventListener("privacy-settings-changed", onPrivacyChanged);
    }, []);

    // Reset revealed state when modal opens
    useEffect(() => {
        if (isOpen) setQrRevealed(false);
    }, [isOpen]);

    const generateCode = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const res = await generateMobilePairingCode();
            setPairingCode(res.code || null);

            if (res.code) {
                const qrContent = res.qrUrl || `https://chat.zhuazhuaai.cn?code=${res.code}`;
                const qrData = await QRCode.toDataURL(qrContent, {
                    margin: 2,
                    width: 250,
                    color: { dark: "#000000FF", light: "#FFFFFFFF" }
                });
                setQrDataUrl(qrData);
            } else {
                setQrDataUrl(null);
            }
        } catch (err: any) {
            setError(t("mobile.generationFailed", { error: err.message || "Unknown error" }));
        } finally {
            setLoading(false);
        }
    }, [t]);

    // Main effect: generate code once and start polling when modal opens
    useEffect(() => {
        if (!isOpen) {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            return;
        }

        let cancelled = false;

        (async () => {
            // Load initial pairing count and generate code (once per modal open)
            try {
                const res = await getMobilePairingStatus();
                const count = res.pairings?.length ?? 0;
                if (!cancelled) {
                    setExistingCount(count);
                    baseCountRef.current = count;
                }
            } catch { /* ignore */ }
            if (!cancelled) await generateCode();
        })();

        // Poll: detect when a NEW pairing appears (count increases)
        pollIntervalRef.current = window.setInterval(async () => {
            try {
                const res = await getMobilePairingStatus();
                const count = res.pairings?.length ?? 0;
                setExistingCount(count);
                if (count > baseCountRef.current && pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                    onBindingSuccessRef.current();
                }
            } catch { /* ignore */ }
        }, 3000);

        return () => {
            cancelled = true;
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, [isOpen, generateCode]);

    const showBlur = privacyMode && !qrRevealed;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t("mobile.statusTitle")}
            maxWidth={420}
        >
            <div className="modal-form-col">
                {error && <div className="modal-error-box">{error}</div>}

                <div className="mobile-pairing-modal-body">
                    {loading && !pairingCode ? (
                        <p>{t("common.loading")}</p>
                    ) : (
                        <div className="mobile-pairing-view">
                            {existingCount > 0 && (
                                <p className="mobile-existing-hint">
                                    {t("mobile.existingPairings", { count: existingCount })}
                                </p>
                            )}

                            <div className="status-badge badge-warning">{t("mobile.waitingForConnection")}</div>
                            <p className="mobile-scan-hint">{t("mobile.scanHint")}</p>

                            {qrDataUrl && (
                                <div
                                    className={`mobile-qr-container${showBlur ? " qr-privacy-blur" : ""}`}
                                    onClick={showBlur ? () => setQrRevealed(true) : undefined}
                                >
                                    <img src={qrDataUrl} alt="Pairing QR Code" width={250} height={250} />
                                    {showBlur && (
                                        <div className="qr-privacy-overlay">
                                            {t("settings.app.clickToReveal")}
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
