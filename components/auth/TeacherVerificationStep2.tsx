import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../context/ThemeContext";
import type { VerificationPhotoSet } from "../../lib/teacherVerificationUpload";
import type { TeacherRegistrationProfile } from "../../shared/teacherRegistration";
import { formatSubjectsSummaryDisplay, getAuthTheme } from "./AuthInput";

export interface TeacherVerificationStep2Props {
  profile: TeacherRegistrationProfile;
  submitting: boolean;
  progressStatus: string;
  onSubmitPhotos: (photos: VerificationPhotoSet) => Promise<void>;
  onSignOut: () => void;
}

type PhotoSlot = "idFront" | "idBack" | "selfie";

export function TeacherVerificationStep2({
  profile,
  submitting,
  progressStatus,
  onSubmitPhotos,
  onSignOut,
}: TeacherVerificationStep2Props) {
  const { darkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const theme = getAuthTheme(darkMode);

  const [idFrontUri, setIdFrontUri] = useState<string | null>(null);
  const [idBackUri, setIdBackUri] = useState<string | null>(null);
  const [selfieUri, setSelfieUri] = useState<string | null>(null);

  async function captureWithCamera(slot: PhotoSlot) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Camera Permission Needed",
        "Please allow camera access so you can capture your Teacher ID and verification selfie."
      );
      return;
    }

    const isSelfie = slot === "selfie";
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      cameraType: isSelfie
        ? ImagePicker.CameraType.front
        : ImagePicker.CameraType.back,
      allowsEditing: true,
      aspect: isSelfie ? [1, 1] : [16, 10],
      quality: 0.85,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      applyPhoto(slot, result.assets[0].uri);
    }
  }

  async function pickFromGallery(slot: PhotoSlot) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photos Permission Needed",
        "Please allow photo library access to upload your verification image."
      );
      return;
    }

    const isSelfie = slot === "selfie";
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: isSelfie ? [1, 1] : [16, 10],
      quality: 0.85,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      applyPhoto(slot, result.assets[0].uri);
    }
  }

  function applyPhoto(slot: PhotoSlot, uri: string) {
    if (slot === "idFront") setIdFrontUri(uri);
    else if (slot === "idBack") setIdBackUri(uri);
    else setSelfieUri(uri);
  }

  const completedCount =
    (idFrontUri ? 1 : 0) + (idBackUri ? 1 : 0) + (selfieUri ? 1 : 0);
  const readyToSubmit = completedCount === 3 && !submitting;

  async function handleSubmit() {
    if (!idFrontUri || !idBackUri || !selfieUri) {
      Alert.alert(
        "Photos Required",
        "Please attach all three required photos: Physical Teacher ID (Front), Physical Teacher ID (Back), and Face Selfie."
      );
      return;
    }
    await onSubmitPhotos({
      idFrontUri,
      idBackUri,
      selfieUri,
    });
  }

  const formattedSubjects = formatSubjectsSummaryDisplay(
    profile.subjectsSummary
  );
  const summaryLine = [
    profile.schoolName,
    formattedSubjects || profile.gradeLevelSummary,
  ]
    .filter(Boolean)
    .join(" · ");

  function renderPhotoCard(config: {
    slot: PhotoSlot;
    stepNum: string;
    title: string;
    desc: string;
    uri: string | null;
    primaryCameraLabel: string;
    isSelfie?: boolean;
  }) {
    const {
      slot,
      stepNum,
      title,
      desc,
      uri,
      primaryCameraLabel,
      isSelfie,
    } = config;
    const isUploaded = Boolean(uri);

    return (
      <View
        style={[
          styles.photoCard,
          {
            backgroundColor: theme.bgSurface,
            borderColor: isUploaded ? theme.success : theme.border,
          },
        ]}
      >
        {/* Card Header */}
        <View style={styles.photoCardHeader}>
          <View
            style={[
              styles.stepBadge,
              {
                backgroundColor: isUploaded ? theme.success : theme.bgSubtle,
              },
            ]}
          >
            {isUploaded ? (
              <Ionicons name="checkmark" size={14} color="#FFFFFF" />
            ) : (
              <Text
                style={[styles.stepBadgeText, { color: theme.textSecondary }]}
              >
                {stepNum}
              </Text>
            )}
          </View>

          <View style={styles.photoHeaderBody}>
            <View style={styles.photoTitleRow}>
              <Text
                style={[styles.photoTitle, { color: theme.textPrimary }]}
                numberOfLines={1}
              >
                {title}
              </Text>
              {isUploaded && (
                <View
                  style={[
                    styles.uploadedBadge,
                    { backgroundColor: theme.successBg },
                  ]}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={13}
                    color={theme.success}
                  />
                  <Text
                    style={[
                      styles.uploadedBadgeText,
                      { color: theme.successText },
                    ]}
                  >
                    Uploaded
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.photoDesc, { color: theme.textMuted }]}>
              {desc}
            </Text>
          </View>
        </View>

        {/* Card Body: Uploaded Preview vs Dual Neutral Actions */}
        {uri ? (
          <View style={styles.previewWrap}>
            <View
              style={[
                isSelfie ? styles.selfieFrame : styles.idFrame,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.bgSubtle,
                },
              ]}
            >
              <Image
                source={{ uri }}
                style={isSelfie ? styles.selfiePreview : styles.idPreview}
                resizeMode="cover"
              />
            </View>

            <View style={styles.retakeRow}>
              <TouchableOpacity
                style={[
                  styles.retakeBtn,
                  {
                    backgroundColor: theme.bgSurface,
                    borderColor: theme.borderInput,
                  },
                ]}
                onPress={() => captureWithCamera(slot)}
                activeOpacity={0.75}
                disabled={submitting}
              >
                <Ionicons
                  name="camera-outline"
                  size={15}
                  color={theme.textSecondary}
                />
                <Text
                  style={[styles.retakeBtnText, { color: theme.textSecondary }]}
                >
                  Retake
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.retakeBtn,
                  {
                    backgroundColor: theme.bgSurface,
                    borderColor: theme.borderInput,
                  },
                ]}
                onPress={() => pickFromGallery(slot)}
                activeOpacity={0.75}
                disabled={submitting}
              >
                <Ionicons
                  name="images-outline"
                  size={15}
                  color={theme.textSecondary}
                />
                <Text
                  style={[styles.retakeBtnText, { color: theme.textSecondary }]}
                >
                  Replace
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.uploadActionsRow}>
            <TouchableOpacity
              style={[
                styles.cameraActionBtn,
                { backgroundColor: theme.btnDarkBg },
              ]}
              onPress={() => captureWithCamera(slot)}
              activeOpacity={0.8}
              disabled={submitting}
            >
              <Ionicons
                name="camera-outline"
                size={17}
                color={theme.btnDarkText}
              />
              <Text
                style={[styles.cameraActionText, { color: theme.btnDarkText }]}
                numberOfLines={1}
              >
                {primaryCameraLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.galleryActionBtn,
                {
                  backgroundColor: theme.bgSurface,
                  borderColor: theme.borderInput,
                },
              ]}
              onPress={() => pickFromGallery(slot)}
              activeOpacity={0.75}
              disabled={submitting}
            >
              <Ionicons
                name="cloud-upload-outline"
                size={17}
                color={theme.textSecondary}
              />
              <Text
                style={[
                  styles.galleryActionText,
                  { color: theme.textSecondary },
                ]}
                numberOfLines={1}
              >
                Upload
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.screenRoot, { backgroundColor: theme.bgPage }]}>
      {/* ── Fixed Opaque Top Header + 3px Progress Bar (Outside ScrollView) ── */}
      <View
        style={[styles.fixedHeader, { backgroundColor: theme.bgSurface }]}
      >
        <View style={styles.fixedHeaderInner}>
          <View
            style={[
              styles.verifiedIndicator,
              { backgroundColor: theme.successBg },
            ]}
          >
            <Ionicons
              name="checkmark-circle"
              size={15}
              color={theme.success}
            />
            <Text
              style={[styles.verifiedText, { color: theme.successText }]}
            >
              Email Verified
            </Text>
          </View>
          <Text style={[styles.stepMetaText, { color: theme.textMuted }]}>
            Step 2 of 2 · Identity
          </Text>
        </View>
        <View
          style={[styles.progressTrack, { backgroundColor: theme.bgSubtle }]}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: "100%",
                backgroundColor:
                  completedCount === 3 ? theme.success : theme.accent,
              },
            ]}
          />
        </View>
      </View>

      {/* ── Scrollable Body ── */}
      <ScrollView
        style={[styles.scrollView, { backgroundColor: theme.bgPage }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentColumn}>
          {/* Page Heading */}
          <View style={styles.pageHeading}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>
              Verify your identity
            </Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              Upload clear photos of your Teacher ID and a quick selfie for
              school verification.
            </Text>
          </View>

          {/* Compact Structured Teacher Summary Strip */}
          <View
            style={[
              styles.teacherStrip,
              { backgroundColor: theme.bgSubtle },
            ]}
          >
            <View style={styles.teacherStripTop}>
              <Text
                style={[styles.teacherName, { color: theme.textPrimary }]}
                numberOfLines={1}
              >
                {profile.fullName}
              </Text>
              {!!profile.teacherId && (
                <Text style={[styles.teacherId, { color: theme.textMuted }]}>
                  ID {profile.teacherId}
                </Text>
              )}
            </View>
            {!!summaryLine && (
              <Text
                style={[styles.teacherSummaryLine, { color: theme.textMuted }]}
                numberOfLines={1}
              >
                {summaryLine}
              </Text>
            )}
          </View>

          {/* 3 Verification Upload Cards */}
          <View style={styles.cardsStack}>
            {renderPhotoCard({
              slot: "idFront",
              stepNum: "1",
              title: "Teacher ID (Front)",
              desc: "Show your photo, full name, and ID number.",
              uri: idFrontUri,
              primaryCameraLabel: "Take Photo",
            })}

            {renderPhotoCard({
              slot: "idBack",
              stepNum: "2",
              title: "Teacher ID (Back)",
              desc: "Show the school seal and validation signature.",
              uri: idBackUri,
              primaryCameraLabel: "Take Photo",
            })}

            {renderPhotoCard({
              slot: "selfie",
              stepNum: "3",
              title: "Face Verification Selfie",
              desc: "Good lighting, no sunglasses or face masks.",
              uri: selfieUri,
              primaryCameraLabel: "Take Selfie",
              isSelfie: true,
            })}
          </View>

          {/* Privacy Notice */}
          <View style={styles.privacyRow}>
            <Ionicons
              name="lock-closed-outline"
              size={15}
              color={theme.textMuted}
              style={styles.privacyIcon}
            />
            <Text style={[styles.privacyText, { color: theme.textMuted }]}>
              Encrypted and visible only to your school administrator for
              account verification.
            </Text>
          </View>

          {/* Sign Out / Finish Later */}
          <Pressable
            style={styles.laterBtn}
            onPress={onSignOut}
            disabled={submitting}
            hitSlop={8}
          >
            <Text style={[styles.laterBtnText, { color: theme.textMuted }]}>
              Finish later (Sign out)
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* ── Sticky Bottom Footer Bar ── */}
      <View
        style={[
          styles.stickyFooter,
          {
            backgroundColor: theme.bgSurface,
            borderTopColor: theme.border,
            paddingBottom: Math.max(insets.bottom, 14),
          },
        ]}
      >
        <View style={styles.stickyFooterInner}>
          {completedCount < 3 && !submitting && (
            <Text style={[styles.progressHint, { color: theme.textMuted }]}>
              {completedCount} of 3 photos uploaded
            </Text>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              {
                backgroundColor:
                  readyToSubmit || submitting
                    ? theme.accent
                    : theme.btnDisabledBg,
              },
              pressed && readyToSubmit && styles.btnPressed,
            ]}
            onPress={handleSubmit}
            disabled={!readyToSubmit}
          >
            {submitting ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={styles.submitBtnText} numberOfLines={1}>
                  {progressStatus || "Uploading photos..."}
                </Text>
              </View>
            ) : (
              <Text
                style={[
                  styles.submitBtnText,
                  !readyToSubmit && { color: theme.btnDisabledText },
                ]}
              >
                Submit for Approval
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    width: "100%",
  },
  /* ── Fixed Opaque Header ── */
  fixedHeader: {
    width: "100%",
    zIndex: 10,
  },
  fixedHeaderInner: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    height: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  verifiedIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  verifiedText: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  stepMetaText: {
    fontSize: 13,
    fontWeight: "500",
  },
  progressTrack: {
    width: "100%",
    height: 3,
  },
  progressFill: {
    height: "100%",
  },
  /* ── Scrollable Body ── */
  scrollView: {
    flex: 1,
    width: "100%",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  contentColumn: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    gap: 14,
  },
  pageHeading: {
    marginBottom: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  /* ── Compact Teacher Summary Strip ── */
  teacherStrip: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  teacherStripTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  teacherName: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  teacherId: {
    fontSize: 12.5,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  teacherSummaryLine: {
    fontSize: 13,
    lineHeight: 18,
  },
  /* ── Verification Cards ── */
  cardsStack: {
    gap: 12,
  },
  photoCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  photoCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepBadgeText: {
    fontSize: 12.5,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  photoHeaderBody: {
    flex: 1,
  },
  photoTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  photoTitle: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  uploadedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  uploadedBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  photoDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  /* ── Card Dual Actions ── */
  uploadActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  cameraActionBtn: {
    flex: 1.25,
    height: 42,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  cameraActionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  galleryActionBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  galleryActionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  /* ── Uploaded Preview State ── */
  previewWrap: {
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  },
  idFrame: {
    width: "100%",
    aspectRatio: 16 / 10,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
  },
  idPreview: {
    width: "100%",
    height: "100%",
  },
  selfieFrame: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: "hidden",
    borderWidth: 1,
  },
  selfiePreview: {
    width: "100%",
    height: "100%",
  },
  retakeRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  retakeBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  retakeBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  /* ── Privacy Notice & Finish Later ── */
  privacyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  privacyIcon: {
    marginTop: 1,
  },
  privacyText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },
  laterBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  laterBtnText: {
    fontSize: 13.5,
    fontWeight: "500",
  },
  /* ── Sticky Bottom Footer ── */
  stickyFooter: {
    width: "100%",
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  stickyFooterInner: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  progressHint: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 8,
    fontVariant: ["tabular-nums"],
  },
  submitBtn: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  btnPressed: {
    opacity: 0.9,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
