import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";

const ORANGE = "#FF6B00";

export interface StudentFormModalProps {
  visible: boolean;
  mode: "add" | "edit";
  lastName: string;
  firstName: string;
  middleName: string;
  email: string;
  onChangeLastName: (v: string) => void;
  onChangeFirstName: (v: string) => void;
  onChangeMiddleName: (v: string) => void;
  onChangeEmail: (v: string) => void;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  darkMode: boolean;
  cardBg: string;
  inputBg: string;
  border: string;
  textMain: string;
  textSub: string;
  btnSecondaryBg: string;
}

export function StudentFormModal({
  visible,
  mode,
  lastName,
  firstName,
  middleName,
  email,
  onChangeLastName,
  onChangeFirstName,
  onChangeMiddleName,
  onChangeEmail,
  saving,
  onSubmit,
  onCancel,
  darkMode,
  cardBg,
  inputBg,
  border,
  textMain,
  textSub,
  btnSecondaryBg,
}: StudentFormModalProps) {
  const isEdit = mode === "edit";
  const submitDisabled = !lastName.trim() || !firstName.trim() || saving;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableWithoutFeedback onPress={onCancel}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
                <View style={styles.sheetDragHandle} />

                <View style={styles.modalHeader}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={[styles.modalTitle, { color: textMain }]}>
                      {isEdit ? "Edit Student Details" : "Add New Student"}
                    </Text>
                    {isEdit && (
                      <Text style={{ fontSize: 12, color: textSub, marginTop: 2 }}>
                        Update student name and email address
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={onCancel}
                    style={[styles.sheetCloseBtn, { backgroundColor: btnSecondaryBg }]}
                  >
                    <Ionicons name="close" size={18} color={textSub} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabel, { color: textSub }]}>
                  Last name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                  placeholder="e.g. Dela Cruz"
                  placeholderTextColor={textSub}
                  value={lastName}
                  onChangeText={onChangeLastName}
                />

                <Text style={[styles.fieldLabel, { color: textSub }]}>
                  First name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                  placeholder="e.g. Juan"
                  placeholderTextColor={textSub}
                  value={firstName}
                  onChangeText={onChangeFirstName}
                />

                <Text style={[styles.fieldLabel, { color: textSub }]}>
                  Middle name <Text style={{ fontSize: 12, fontWeight: "400", color: textSub }}>(optional)</Text>
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                  placeholder="e.g. Santos"
                  placeholderTextColor={textSub}
                  value={middleName}
                  onChangeText={onChangeMiddleName}
                />

                <Text style={[styles.fieldLabel, { color: textSub }]}>
                  Email address{" "}
                  {isEdit && !email.trim() ? (
                    <Text style={{ color: ORANGE, fontSize: 11, fontWeight: "600" }}>(No email set)</Text>
                  ) : null}
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                  placeholder="e.g. juan.delacruz@school.edu.ph"
                  placeholderTextColor={textSub}
                  value={email}
                  onChangeText={onChangeEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.cancelBtn, { borderColor: border, backgroundColor: btnSecondaryBg }]}
                    onPress={onCancel}
                    disabled={isEdit && saving}
                  >
                    <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.addBtn,
                      submitDisabled
                        ? [styles.addBtnDisabled, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9", borderColor: border }]
                        : { backgroundColor: ORANGE },
                    ]}
                    onPress={onSubmit}
                    disabled={submitDisabled}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text
                        style={[
                          styles.addBtnText,
                          (!lastName.trim() || !firstName.trim()) && { color: "#94A3B8" },
                        ]}
                      >
                        {isEdit ? "Save Changes" : "Add Student"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 28,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  sheetDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 14,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: "700",
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 10,
  },
  required: {
    color: "#EF4444",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  addBtn: {
    flex: 1.4,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnDisabled: {
    borderWidth: 1,
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
