## Explainable AI for 311 Complaint Escalation
- **Purpose**: Predict likely resolution delays in Philadelphia 311 requests, explain risk factors, and optionally retrieve similar historical resolutions and official municipal procedures.
- **MVP**: Data preprocessing, delay prediction, SHAP explanations, and Streamlit dashboard.
- **Data sources**: OpenDataPhilly 311 dataset and publicly available City of Philadelphia operating policies.
- **Technology**: Python, Pandas, NumPy, Scikit-learn, XGBoost, SHAP, Streamlit, OpenAI Embeddings, Chroma, and OpenAI API where approved.
- **Responsible AI**: The system is decision support only. It must not deprioritize requests or treat ZIP code correlations as causal explanations.
- **Setup**: Clone repository, create a virtual environment, install requirements, configure environment variables, and run the Streamlit application using the documented command.



  
**Team**: Anthony Martini, Riteesh Katta, Jamie Toghranegar.
